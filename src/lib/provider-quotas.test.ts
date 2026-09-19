import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch as undiciFetch } from "undici";
import type { Response as UndiciResponse } from "undici";
import { createQuotaService, parseQuotas, parseWeeklySummary, requestQuota } from "./provider-quotas";
import type { QuotaProviderId } from "./quota-types";

// The real requestQuota must never touch real credentials or the network in tests.
vi.mock("undici", () => ({
  fetch: vi.fn(),
  EnvHttpProxyAgent: class EnvHttpProxyAgent {},
}));

const raw = { rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1790000000 }, secondary_window: { used_percent: 2, limit_window_seconds: 604800 } } };
function fixture() {
  let now = 1780000000000;
  let auth: unknown = { "openai-codex": { type: "oauth", access: "SECRET", expires: now + 86400000 }, antigravity: { type: "oauth", access: "GOOGLE_SECRET", expires: now + 86400000 } };
  const request = vi.fn<(id: QuotaProviderId) => Promise<{ status: number; data?: unknown }>>(async () => ({ status: 200, data: raw }));
  const readAuth = vi.fn(async () => auth);
  const get = createQuotaService({ readAuth, request, now: () => now });
  return { get, request, readAuth, advance: (ms: number) => { now += ms; }, auth: (value: unknown) => { auth = value; } };
}

describe("quota parsing", () => {
  it("converts used percentages and epoch reset time", () => {
    const q = parseQuotas("openai-codex", raw);
    expect(q.map(q => q.remainingPercent)).toEqual([88, 98]);
    expect(q.map(q => q.label)).toEqual(["5 小时额度", "每周额度"]);
    expect(q[0].resetAt).toBe(new Date(1790000000000).toISOString());
    expect(q[1].resetAt).toBeNull();
  });
  it("does not interpret missing, null or strings as zero usage", () => {
    for (const used_percent of [undefined, null, "0", NaN, Infinity]) {
      expect(parseQuotas("openai-codex", { rate_limit: { primary_window: { used_percent } } })).toEqual([]);
    }
  });
  it("filters internal models, groups families, and preserves valid zero while clamping", () => {
    const models = {
      "gemini-zero": { quotaInfo: { remainingFraction: 0, resetTime: "invalid" } },
      "claude-full": { displayName: "Claude", quotaInfo: { remainingFraction: 1.2 } },
      "gpt-hidden": { isInternal: true, quotaInfo: { remainingFraction: 1 } },
      "tab-internal": { quotaInfo: { remainingFraction: 1 } },
      "gemini-missing": { quotaInfo: {} },
    };
    const q = parseQuotas("antigravity", { models });
    expect(q).toHaveLength(2);
    expect(q.find(w => w.id === "gemini")).toMatchObject({ remainingPercent: 0, resetAt: null });
    expect(q.find(w => w.id === "gemini")?.members).toEqual([{ id: "gemini-zero", label: "gemini-zero", remainingPercent: 0, resetAt: null }]);
    expect(q.find(w => w.id === "claude")?.remainingPercent).toBe(100);
  });

  it("groups Gemini and Claude by lowest remaining percent with that entry's reset time", () => {
    const resetA = "2026-06-01T00:00:00Z";
    const resetB = "2026-06-02T00:00:00Z";
    const models = {
      "gemini-3-flash": { displayName: "Gemini Flash", quotaInfo: { remainingFraction: 0.4, resetTime: resetB } },
      "gemini-2-pro": { displayName: "Gemini Pro", quotaInfo: { remainingFraction: 0.15, resetTime: resetA } },
      "gemini-image": { displayName: "Image", quotaInfo: { remainingFraction: 0.9, resetTime: resetB } },
      "claude-sonnet": { displayName: "Sonnet", quotaInfo: { remainingFraction: 0.5, resetTime: resetA } },
      "claude-opus": { displayName: "Opus", quotaInfo: { remainingFraction: 0.5, resetTime: resetA } },
      "gpt-oss": { displayName: "GPT OSS", quotaInfo: { remainingFraction: 0.7, resetTime: resetB } },
    };
    const q = parseQuotas("antigravity", { models });
    // Family groups first, then image and other models individually (no whitelist, nothing dropped).
    expect(q.map(w => w.id)).toEqual(["gemini", "claude", "gpt-oss", "gemini-image"]);
    const gemini = q[0];
    expect(gemini).toMatchObject({
      label: "Gemini (Flash / Pro)",
      remainingPercent: 15,
      resetAt: new Date(resetA).toISOString(),
      inconsistent: true,
    });
    expect(gemini.members).toEqual([
      { id: "gemini-3-flash", label: "Gemini Flash", remainingPercent: 40, resetAt: new Date(resetB).toISOString() },
      { id: "gemini-2-pro", label: "Gemini Pro", remainingPercent: 15, resetAt: new Date(resetA).toISOString() },
    ]);
    expect(q[1]).toMatchObject({ label: "Claude (Sonnet / Opus)", remainingPercent: 50, resetAt: new Date(resetA).toISOString() });
    expect(q[1].inconsistent).toBeUndefined();
    expect(q[2]).toMatchObject({ id: "gpt-oss", label: "GPT OSS", remainingPercent: 70 });
    expect(q[3]).toMatchObject({ id: "gemini-image", label: "Image", remainingPercent: 90 });
  });

  it("flags groups whose reset times disagree even when percentages match", () => {
    const models = {
      "claude-sonnet": { quotaInfo: { remainingFraction: 0.3, resetTime: "2026-06-01T00:00:00Z" } },
      "claude-opus": { quotaInfo: { remainingFraction: 0.3, resetTime: "2026-06-05T00:00:00Z" } },
    };
    const [claude] = parseQuotas("antigravity", { models });
    expect(claude).toMatchObject({ id: "claude", remainingPercent: 30, inconsistent: true });
    expect(claude.members).toHaveLength(2);
  });
});

describe("antigravity weekly summary", () => {
  it("parses weekly buckets from groups with numeric and numeric-string fractions", () => {
    const q = parseWeeklySummary({
      groups: [
        { displayName: "Gemini API", buckets: [
          { bucketId: "gemini_5h", displayName: "Five hour", remainingFraction: 0.5 },
          { bucketId: "gemini_weekly", displayName: "Weekly", remainingFraction: "0.25", resetTime: 1790000000 },
        ]},
        { displayName: "Claude & GPT API", buckets: [
          { bucketId: "claude_gpt", displayName: "Weekly limit", remainingFraction: 0.75 },
        ]},
        { displayName: "Something Else", buckets: [
          { bucketId: "other_weekly", displayName: "Weekly", remainingFraction: 1 },
        ]},
      ],
    });
    expect(q).toEqual([
      { id: "gemini_weekly", label: "Gemini (Weekly)", remainingPercent: 25, resetAt: new Date(1790000000000).toISOString() },
      { id: "claude_gpt_weekly", label: "Claude & GPT (Weekly)", remainingPercent: 75, resetAt: null },
    ]);
  });

  it("accepts nested quotaSummary.groups and merges into parseQuotas output", () => {
    const q = parseWeeklySummary({ quotaSummary: { groups: [
      { displayName: "Gemini", buckets: [{ bucketId: "weekly", remainingFraction: 0.1 }] },
    ]}});
    expect(q.map(w => [w.id, w.remainingPercent])).toEqual([["gemini_weekly", 10]]);
    const merged = parseQuotas("antigravity", {
      models: { "gemini-3-flash": { quotaInfo: { remainingFraction: 0.5 } } },
      weeklyQuotaSummary: { groups: [{ displayName: "Gemini", buckets: [{ bucketId: "weekly", remainingFraction: 0.1 }] }] },
    });
    expect(merged.map(w => w.id)).toEqual(["gemini", "gemini_weekly"]);
  });

  it.each([[null], [true], [""], ["abc"], [Number.NaN], [Number.POSITIVE_INFINITY]])("rejects invalid remainingFraction %p", value => {
    expect(parseWeeklySummary({ groups: [
      { displayName: "Gemini", buckets: [{ bucketId: "weekly", remainingFraction: value }] },
    ]})).toEqual([]);
  });

  it("skips disabled buckets, non-weekly buckets, and keeps the first valid bucket per family", () => {
    const q = parseWeeklySummary({ groups: [{ displayName: "Gemini API", buckets: [
      { bucketId: "gemini_weekly", displayName: "Weekly", remainingFraction: 0.9, disabled: true },
      { bucketId: "gemini_5h", displayName: "5 hour", remainingFraction: 0.8 },
      { bucketId: "gemini_weekly_2", displayName: "Weekly backup", remainingFraction: 0.4 },
      { bucketId: "gemini_weekly_3", displayName: "Weekly again", remainingFraction: 0.3 },
    ]}]});
    expect(q).toEqual([{ id: "gemini_weekly", label: "Gemini (Weekly)", remainingPercent: 40, resetAt: null }]);
  });

  it("returns no windows for missing or malformed input", () => {
    for (const raw of [undefined, null, 42, "x", {}, { groups: "nope" }, { groups: [null, "x"] }, { quotaSummary: 1 }]) {
      expect(parseWeeklySummary(raw)).toEqual([]);
    }
  });
});

describe("quota service", () => {
  it("isolates unavailable provider and exposes no credentials", async () => {
    const f = fixture();
    const result = await f.get();
    expect(result.providers.map(p => p.status)).toEqual(["ok", "unavailable"]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("caches, throttles manual refresh, and deduplicates concurrent calls", async () => {
    const f = fixture();
    await Promise.all([f.get(), f.get()]);
    expect(f.request).toHaveBeenCalledTimes(2);
    await f.get(true);
    expect(f.request).toHaveBeenCalledTimes(2);
    f.advance(16000);
    await f.get();
    expect(f.request).toHaveBeenCalledTimes(2);
    await f.get(true);
    expect(f.request).toHaveBeenCalledTimes(4);
    f.advance(300001);
    await f.get();
    expect(f.request).toHaveBeenCalledTimes(6);
  });
  it("preserves success as stale after failure without leaking error details", async () => {
    const f = fixture();
    const first = await f.get();
    f.advance(300001);
    f.request.mockRejectedValue(new Error("SECRET upstream response"));
    const result = await f.get();
    expect(result.providers[0]).toMatchObject({ status: "unavailable", stale: true, quotas: first.providers[0].quotas, updatedAt: first.providers[0].updatedAt });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("invalidates stale data when credentials change", async () => {
    const f = fixture();
    await f.get();
    f.auth({ "openai-codex": { type: "oauth", access: "NEW_ACCOUNT" } });
    f.request.mockRejectedValue(new Error("failed"));
    const result = await f.get();
    expect(result.providers[0]).toMatchObject({ status: "unavailable", stale: false, quotas: [] });
    expect(result.providers[1].status).toBe("unauthenticated");
  });
  it("does not request missing or expired credentials", async () => {
    const f = fixture();
    f.auth({ "openai-codex": { type: "oauth", access: "SECRET", expires: 1 } });
    expect((await f.get()).providers.map(p => p.status)).toEqual(["expired", "unauthenticated"]);
    expect(f.request).not.toHaveBeenCalled();
  });
  it("handles unreadable auth and distinguishes missing file", async () => {
    const f = fixture();
    f.readAuth.mockRejectedValue(new Error("SECRET bad json"));
    expect((await f.get()).providers.every(p => p.status === "unavailable")).toBe(true);
    f.readAuth.mockRejectedValue(Object.assign(new Error(), { code: "ENOENT" }));
    expect((await f.get()).providers.every(p => p.status === "unauthenticated")).toBe(true);
  });
  it.each([401, 403, 429, 500])("handles HTTP %s safely", async status => {
    const f = fixture();
    f.request.mockResolvedValue({ status, data: raw });
    expect((await f.get()).providers[0].status).toBe(status === 401 ? "expired" : "unavailable");
  });
  it("keeps model quotas when the weekly summary request fails", async () => {
    const f = fixture();
    f.request.mockImplementation(async id => id === "openai-codex"
      ? { status: 200, data: raw }
      : { status: 200, data: { models: { "gemini-3-flash": { quotaInfo: { remainingFraction: 0.5, resetTime: 1790000000 } } }, weeklyUnavailable: true } });
    const result = await f.get();
    const antigravity = result.providers[1];
    expect(antigravity.status).toBe("ok");
    expect(antigravity.message).toBe("周额度暂时不可用，模型额度不受影响");
    expect(antigravity.quotas).toEqual([
      { id: "gemini", label: "Gemini (Flash / Pro)", remainingPercent: 50, resetAt: new Date(1790000000000).toISOString(),
        members: [{ id: "gemini-3-flash", label: "gemini-3-flash", remainingPercent: 50, resetAt: new Date(1790000000000).toISOString() }] },
    ]);
  });
  it("exposes weekly quotas from the merged summary without a warning message", async () => {
    const f = fixture();
    f.request.mockImplementation(async id => id === "openai-codex"
      ? { status: 200, data: raw }
      : { status: 200, data: { models: { "gemini-3-flash": { quotaInfo: { remainingFraction: 0.5 } } },
        weeklyQuotaSummary: { groups: [{ displayName: "Gemini API", buckets: [{ bucketId: "gemini_weekly", remainingFraction: 0.2 }] }] } } });
    const result = await f.get();
    const antigravity = result.providers[1];
    expect(antigravity.status).toBe("ok");
    expect(antigravity.message).toBeUndefined();
    expect(antigravity.quotas.map(w => [w.id, w.remainingPercent])).toEqual([["gemini", 50], ["gemini_weekly", 20]]);
  });
  it("reports explicitly when the API returns no weekly quota", async () => {
    const f = fixture();
    f.request.mockImplementation(async id => id === "openai-codex"
      ? { status: 200, data: raw }
      : { status: 200, data: { models: { "gemini-3-flash": { quotaInfo: { remainingFraction: 0.5 } } }, weeklyEmpty: true } });
    const result = await f.get();
    const antigravity = result.providers[1];
    expect(antigravity.status).toBe("ok");
    expect(antigravity.message).toBe("接口未返回周额度，模型额度不受影响");
    expect(antigravity.quotas).toHaveLength(1);
  });
});

describe("requestQuota (mocked undici)", () => {
  const auth = { type: "oauth", access: "GOOGLE_SECRET", projectId: "PROJECT_123" };
  const modelsData = { models: { "gemini-3-flash": { quotaInfo: { remainingFraction: 0.5, resetTime: 1790000000 } } } };
  const weeklyData = { groups: [{ displayName: "Gemini API", buckets: [{ bucketId: "gemini_weekly", remainingFraction: 0.3 }] }] };
  const mockFetch = vi.mocked(undiciFetch);

  function jsonRes(body: unknown, opts: { status?: number; badJson?: boolean } = {}) {
    const cancel = vi.fn(async () => {});
    const status = opts.status ?? 200;
    const res = {
      ok: status >= 200 && status < 300,
      status,
      body: { cancel },
      json: async () => { if (opts.badJson) throw new Error("SECRET upstream body"); return body; },
    };
    return { res: res as unknown as UndiciResponse, cancel };
  }

  beforeEach(() => mockFetch.mockReset());

  it("POSTs to both Antigravity endpoints with auth header and project body, merging a valid weekly summary", async () => {
    const model = jsonRes({ ...modelsData });
    const weekly = jsonRes(weeklyData);
    mockFetch.mockResolvedValueOnce(model.res).mockResolvedValueOnce(weekly.res);
    const result = await requestQuota("antigravity", auth);
    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [modelCall, weeklyCall] = mockFetch.mock.calls;
    expect(modelCall?.[0]).toBe("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels");
    expect(weeklyCall?.[0]).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary");
    for (const opts of [modelCall?.[1], weeklyCall?.[1]].map(o => o as unknown as Record<string, unknown>)) {
      expect(opts?.method).toBe("POST");
      expect(opts?.headers).toMatchObject({
        Authorization: "Bearer GOOGLE_SECRET", "Content-Type": "application/json",
        "User-Agent": "antigravity/1.107.0", "X-Client-Name": "antigravity",
      });
      expect(opts?.body).toBe(JSON.stringify({ project: "PROJECT_123" }));
      expect(opts?.redirect).toBe("error");
    }
    expect(result.data).toMatchObject({ models: modelsData.models, weeklyQuotaSummary: weeklyData });
    expect(parseQuotas("antigravity", result.data).map(w => w.id)).toContain("gemini_weekly");
    expect(model.cancel).not.toHaveBeenCalled();
  });

  it("uses the IDE weekly bucket rather than the stable backend's 100% bucket", async () => {
    mockFetch.mockImplementation(async url => {
      if (String(url).endsWith(":fetchAvailableModels")) return jsonRes({ ...modelsData }).res;
      const remainingFraction = String(url).startsWith("https://daily-cloudcode-pa.googleapis.com/") ? 0.45985445 : 1;
      return jsonRes({ groups: [{ displayName: "Gemini Models", buckets: [
        { bucketId: "gemini-weekly", displayName: "Weekly Limit Remaining", remainingFraction },
      ] }] }).res;
    });
    const result = await requestQuota("antigravity", auth);
    const weekly = parseQuotas("antigravity", result.data).find(w => w.id === "gemini_weekly");
    expect(weekly?.remainingPercent).toBeCloseTo(45.985445);
    expect(Math.round(weekly!.remainingPercent)).toBe(46);
  });

  it("sends an empty body when projectId is missing", async () => {
    const model = jsonRes({ ...modelsData });
    const weekly = jsonRes(weeklyData);
    mockFetch.mockResolvedValueOnce(model.res).mockResolvedValueOnce(weekly.res);
    await requestQuota("antigravity", { type: "oauth", access: "GOOGLE_SECRET" });
    expect((mockFetch.mock.calls[0]?.[1] as unknown as Record<string, unknown> | undefined)?.body).toBe("{}");
    expect((mockFetch.mock.calls[1]?.[1] as unknown as Record<string, unknown> | undefined)?.body).toBe("{}");
  });

  it("keeps model quotas when weekly returns 403, throws, or invalid JSON", async () => {
    const run = async (weekly: { res: UndiciResponse; cancel: ReturnType<typeof vi.fn> } | "throw") => {
      const model = jsonRes({ ...modelsData });
      if (weekly === "throw") mockFetch.mockResolvedValueOnce(model.res).mockRejectedValueOnce(new Error("SECRET network"));
      else mockFetch.mockResolvedValueOnce(model.res).mockResolvedValueOnce(weekly.res);
      const result = await requestQuota("antigravity", auth);
      expect(result.status).toBe(200);
      expect(result.data).toMatchObject({ models: modelsData.models, weeklyUnavailable: true });
      expect((result.data as { weeklyQuotaSummary?: unknown }).weeklyQuotaSummary).toBeUndefined();
      expect(parseQuotas("antigravity", result.data).map(w => w.id)).toEqual(["gemini"]);
      expect(JSON.stringify(result)).not.toContain("SECRET");
      return result;
    };
    mockFetch.mockReset();
    const forbidden = jsonRes({}, { status: 403 });
    await run(forbidden);
    expect(forbidden.cancel).toHaveBeenCalledTimes(1);
    mockFetch.mockReset();
    await run("throw");
    mockFetch.mockReset();
    await run(jsonRes(weeklyData, { badJson: true }));
  });

  it("marks weeklyEmpty when weekly returns 200 without any valid weekly bucket", async () => {
    for (const body of [{}, { groups: [{ displayName: "Gemini API", buckets: [{ bucketId: "gemini_5h", remainingFraction: 0.5 }] }] }]) {
      mockFetch.mockReset();
      const model = jsonRes({ ...modelsData });
      const weekly = jsonRes(body);
      mockFetch.mockResolvedValueOnce(model.res).mockResolvedValueOnce(weekly.res);
      const result = await requestQuota("antigravity", auth);
      expect(result.data).toMatchObject({ models: modelsData.models, weeklyEmpty: true });
      expect((result.data as { weeklyQuotaSummary?: unknown }).weeklyQuotaSummary).toBeUndefined();
    }
  });

  it("stops after the failed model endpoint without requesting weekly and cancels the body", async () => {
    const model = jsonRes({}, { status: 403 });
    mockFetch.mockResolvedValueOnce(model.res);
    const result = await requestQuota("antigravity", auth);
    expect(result.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(model.cancel).toHaveBeenCalledTimes(1);
  });

  it("issues exactly one GET request for Codex with account header and no weekly call", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(raw).res);
    const result = await requestQuota("openai-codex", { type: "oauth", access: "OPENAI_SECRET", accountId: "ACCOUNT_1" });
    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, unknown];
    expect(url).toBe("https://chatgpt.com/backend-api/wham/usage");
    const init = opts as Record<string, unknown>;
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ Authorization: "Bearer OPENAI_SECRET", "ChatGPT-Account-Id": "ACCOUNT_1" });
    expect(init.body).toBeUndefined();
  });
});
