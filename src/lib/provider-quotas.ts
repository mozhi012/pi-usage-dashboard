// Server-side only: credentials must never leave this module.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fetch as proxyFetch, EnvHttpProxyAgent } from "undici";
import type { ProviderQuota, QuotaProviderId, QuotaResponse, QuotaWindow, QuotaWindowMember } from "./quota-types";

const NAMES = { "openai-codex": "OpenAI Codex", antigravity: "Antigravity" };
const IDS = Object.keys(NAMES) as QuotaProviderId[];
const TTL = 5 * 60_000;
const MIN_REFRESH = 15_000;
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function resetDate(value: unknown): string | null {
  const ms = finite(value) ? value * 1000 : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null;
}
const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** Weekly summary accepts finite numbers or non-empty numeric strings; null/bool/empty are invalid. */
function fraction(value: unknown): number | null {
  if (finite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const WEEKLY_FAMILIES: { pattern: RegExp; id: string; label: string }[] = [
  { pattern: /gemini/i, id: "gemini_weekly", label: "Gemini (Weekly)" },
  { pattern: /claude|gpt/i, id: "claude_gpt_weekly", label: "Claude & GPT (Weekly)" },
];

/** Parses a retrieveUserQuotaSummary payload (top-level or nested groups). Pure, for tests. */
export function parseWeeklySummary(raw: unknown): QuotaWindow[] {
  const summary = record(raw);
  const nested = record(summary.quotaSummary);
  const groups = Array.isArray(summary.groups) ? summary.groups
    : Array.isArray(nested.groups) ? nested.groups : [];
  const windows: QuotaWindow[] = [];
  for (const groupValue of groups) {
    const group = record(groupValue);
    const displayName = group.displayName;
    const family = typeof displayName === "string"
      ? WEEKLY_FAMILIES.find(f => f.pattern.test(displayName)) : undefined;
    if (!family || windows.some(w => w.id === family.id)) continue;
    for (const bucketValue of Array.isArray(group.buckets) ? group.buckets : []) {
      const bucket = record(bucketValue);
      const text = `${typeof bucket.bucketId === "string" ? bucket.bucketId : ""} ${typeof bucket.displayName === "string" ? bucket.displayName : ""}`.toLowerCase();
      if (!text.includes("weekly") || bucket.disabled === true) continue;
      const remaining = fraction(bucket.remainingFraction);
      if (remaining === null) continue;
      windows.push({ id: family.id, label: family.label, remainingPercent: clamp(remaining * 100), resetAt: resetDate(bucket.resetTime) });
      break;
    }
  }
  return windows;
}

type AntigravityEntry = QuotaWindow;

/** Antigravity: group non-image Gemini and Claude models, keep image/other models individually. */
function parseAntigravity(data: RecordValue): QuotaWindow[] {
  const entries: AntigravityEntry[] = Object.entries(record(data.models)).flatMap(([key, value]) => {
    const model = record(value);
    const quota = record(model.quotaInfo);
    if (model.isInternal || !/^(gemini-|claude-|gpt-)/.test(key) || !finite(quota.remainingFraction)) return [];
    return [{ id: key, label: typeof model.displayName === "string" ? model.displayName : key,
      remainingPercent: clamp(quota.remainingFraction * 100), resetAt: resetDate(quota.resetTime) }];
  });
  const byLabel = (a: AntigravityEntry, b: AntigravityEntry) => a.label.localeCompare(b.label);
  const windows: QuotaWindow[] = [];
  for (const [group, label, matches] of [
    ["gemini", "Gemini (Flash / Pro)", (entry: AntigravityEntry) => entry.id.startsWith("gemini-") && !entry.id.includes("image")],
    ["claude", "Claude (Sonnet / Opus)", (entry: AntigravityEntry) => entry.id.startsWith("claude-")],
  ] as const) {
    const members = entries.filter(matches).sort(byLabel);
    if (!members.length) continue;
    const lowest = members.reduce((min, entry) => entry.remainingPercent < min.remainingPercent ? entry : min);
    const inconsistent = members.some(entry => entry.remainingPercent !== lowest.remainingPercent || entry.resetAt !== lowest.resetAt);
    const details: QuotaWindowMember[] = members.map(entry => ({ id: entry.id, label: entry.label, remainingPercent: entry.remainingPercent, resetAt: entry.resetAt }));
    windows.push({ id: group, label, remainingPercent: lowest.remainingPercent, resetAt: lowest.resetAt,
      members: details, ...(inconsistent ? { inconsistent: true } : {}) });
  }
  for (const entry of entries.filter(entry => entry.id.startsWith("gpt-") || entry.id.includes("image")).sort(byLabel)) windows.push(entry);
  return [...windows, ...parseWeeklySummary(data.weeklyQuotaSummary)];
}

// The upstream percentages are NOT request counts or token totals.
export function parseQuotas(id: QuotaProviderId, raw: unknown): QuotaWindow[] {
  const data = record(raw);
  if (id === "openai-codex") {
    const limits = record(data.rate_limit);
    return ["primary_window", "secondary_window"].flatMap((key, index) => {
      const window = record(limits[key]);
      if (!finite(window.used_percent)) return [];
      const seconds = window.limit_window_seconds;
      const label = seconds === 18000 ? "5 小时额度" : seconds === 604800 ? "每周额度"
        : finite(seconds) && seconds > 0 ? `${Math.round(seconds / 3600 * 10) / 10} 小时额度`
        : index === 0 ? "短周期额度" : "长周期额度";
      return [{ id: key, label, remainingPercent: clamp(100 - window.used_percent), resetAt: resetDate(window.reset_at) }];
    });
  }
  return parseAntigravity(data);
}

type RequestQuota = (id: QuotaProviderId, auth: RecordValue) => Promise<{ status: number; data?: unknown }>;
let dispatcher: EnvHttpProxyAgent | undefined;
const fetchAntigravity = async (auth: RecordValue, path: string): Promise<{ status: number; data?: unknown }> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.access}`, Accept: "application/json", "Content-Type": "application/json",
    "User-Agent": "antigravity/1.107.0", "X-Client-Name": "antigravity",
  };
  // Weekly quotas must use the IDE (daily) backend, as in 9router.
  // The stable backend can return a different Gemini weekly bucket (e.g. 100%).
  const baseUrl = path === "v1internal:retrieveUserQuotaSummary"
    ? "https://daily-cloudcode-pa.googleapis.com"
    : "https://cloudcode-pa.googleapis.com";
  const response = await proxyFetch(`${baseUrl}/${path}`, {
    dispatcher, method: "POST", headers,
    body: JSON.stringify(typeof auth.projectId === "string" ? { project: auth.projectId } : {}),
    signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store",
  });
  if (!response.ok) { await response.body?.cancel(); return { status: response.status }; }
  return { status: response.status, data: await response.json() };
};

export const requestQuota: RequestQuota = async (id, auth) => {
  dispatcher ??= new EnvHttpProxyAgent();
  if (id !== "openai-codex") {
    const response = await fetchAntigravity(auth, "v1internal:fetchAvailableModels");
    if (!response.data || response.status < 200 || response.status >= 300) return response;
    // Best-effort weekly summary: its failure must never break per-model quotas.
    const payload: RecordValue = { ...record(response.data) };
    try {
      const weekly = await fetchAntigravity(auth, "v1internal:retrieveUserQuotaSummary");
      const ok = weekly.status >= 200 && weekly.status < 300;
      if (!ok) payload.weeklyUnavailable = true;
      else if (parseWeeklySummary(weekly.data).length > 0) payload.weeklyQuotaSummary = weekly.data;
      else payload.weeklyEmpty = true;
    } catch { payload.weeklyUnavailable = true; }
    return { status: response.status, data: payload };
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${auth.access}`, Accept: "application/json" };
  if (typeof auth.accountId === "string") headers["ChatGPT-Account-Id"] = auth.accountId;
  const response = await proxyFetch("https://chatgpt.com/backend-api/wham/usage", {
    dispatcher, method: "GET", headers,
    signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store",
  });
  if (!response.ok) { await response.body?.cancel(); return { status: response.status }; }
  return { status: response.status, data: await response.json() };
};

interface Entry { key: string; at: number; value?: ProviderQuota; pending?: Promise<ProviderQuota> }
/** Dependency injection keeps tests isolated from real credentials and upstream APIs. */
export function createQuotaService(deps: {
  readAuth: () => Promise<unknown>;
  request: RequestQuota;
  now: () => number;
}) {
  const cache = new Map<QuotaProviderId, Entry>();
  return async (force = false): Promise<QuotaResponse> => {
    let auth: RecordValue;
    let readFailed = false;
    try { auth = record(await deps.readAuth()); } catch (error) {
      auth = {};
      readFailed = record(error).code !== "ENOENT";
    }
    const providers = await Promise.all(IDS.map(async (id): Promise<ProviderQuota> => {
      const credential = record(auth[id]);
      const base: ProviderQuota = { id, name: NAMES[id], status: "unavailable", quotas: [], updatedAt: null, stale: false };
      if (readFailed) { cache.delete(id); return { ...base, message: "无法读取 Pi 登录文件" }; }
      if (credential.type !== "oauth" || typeof credential.access !== "string" || !credential.access) {
        cache.delete(id);
        return { ...base, status: "unauthenticated", message: "未检测到 Pi OAuth 登录，请先在 Pi 中登录" };
      }
      // Fingerprint credentials so account switches never reuse another account's quota.
      const key = createHash("sha256").update(JSON.stringify(credential)).digest("hex");
      let entry = cache.get(id);
      if (entry?.key !== key) { entry = { key, at: 0 }; cache.set(id, entry); }
      const current = entry!;
      const old = current.value;
      const failure = (status: ProviderQuota["status"], message: string): ProviderQuota => ({
        ...base, status, message, quotas: old?.quotas ?? [], updatedAt: old?.updatedAt ?? null,
        stale: Boolean(old?.quotas.length),
      });
      if (finite(credential.expires) && credential.expires <= deps.now()) {
        return failure("expired", "Pi 登录凭据已过期，请在 Pi 中刷新登录后重试");
      }
      if (current.pending) return current.pending;
      if (current.value && deps.now() - current.at < (force ? MIN_REFRESH : TTL)) return current.value;
      current.pending = (async () => {
        let result: ProviderQuota;
        try {
          const response = await deps.request(id, credential);
          if (response.status === 401) result = failure("expired", "登录已失效，请在 Pi 中重新登录后重试");
          else if (response.status === 403) result = failure("unavailable", "额度接口拒绝访问，模型调用可能仍然可用");
          else if (response.status === 429) result = failure("unavailable", "额度查询受到限流，请稍后刷新");
          else if (response.status < 200 || response.status >= 300) result = failure("unavailable", "额度服务暂不可用，请稍后刷新");
          else {
            const data = record(response.data);
            const quotas = parseQuotas(id, response.data);
            const plan = data.plan_type;
            result = quotas.length ? { ...base, status: "ok", quotas, updatedAt: new Date(deps.now()).toISOString(),
              ...(id === "openai-codex" && typeof plan === "string" ? { plan } : {}),
              ...(id === "antigravity"
                ? data.weeklyUnavailable === true
                  ? { message: "周额度暂时不可用，模型额度不受影响" }
                  : data.weeklyEmpty === true
                    ? { message: "接口未返回周额度，模型额度不受影响" }
                    : {}
                : {}) }
              : failure("unavailable", "接口未返回可用额度数据");
          }
        } catch {
          // Never echo errors: fetch errors can contain tokens, proxy URLs or response bodies.
          result = failure("unavailable", "查询失败或超时，请检查网络和 HTTP(S)_PROXY 代理设置");
        }
        current.value = result;
        current.at = deps.now();
        return result;
      })();
      try { return await current.pending; } finally { current.pending = undefined; }
    }));
    return { providers };
  };
}

export const getProviderQuotas = createQuotaService({
  readAuth: async () => JSON.parse(await readFile(join(homedir(), ".pi", "agent", "auth.json"), "utf8")),
  request: requestQuota,
  now: Date.now,
});
