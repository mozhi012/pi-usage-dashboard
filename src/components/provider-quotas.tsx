"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, EyeOff, RefreshCw } from "lucide-react";
import type { ProviderQuota, QuotaResponse, QuotaWindow } from "@/lib/quota-types";

export function resetCountdown(resetAt: string | null, now: number): string {
  if (!resetAt) return "重置时间未知";
  const delta = Date.parse(resetAt) - now;
  if (!Number.isFinite(delta)) return "重置时间未知";
  if (delta <= 0) return "已到重置时间，待刷新";
  const minutes = Math.ceil(delta / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  return `${days ? `${days}天 ` : ""}${hours ? `${hours}小时 ` : ""}${minutes % 60}分钟后重置`;
}

const ANTIGRAVITY_ID = "antigravity";

const hiddenQuotasKey = (providerId: string) => `pi-usage-dashboard:hidden-quotas:${providerId}`;

/** 读取该 provider 已隐藏的分组 id；存储不可用或结构非法时回退为空集合，不抛异常。 */
function readHiddenQuotas(providerId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(hiddenQuotasKey(providerId));
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

/** 持久化隐藏分组；失败（禁用/配额超限等）时静默降级为仅会话内生效。 */
function writeHiddenQuotas(providerId: string, ids: string[]) {
  try {
    window.localStorage.setItem(hiddenQuotasKey(providerId), JSON.stringify(ids));
  } catch {
    // 忽略：仅本次会话内隐藏
  }
}

function progressColor(remainingPercent: number): string {
  return remainingPercent <= 10 ? "bg-red-500" : remainingPercent <= 30 ? "bg-amber-500" : "bg-emerald-500";
}

function formatPercent(remainingPercent: number): string {
  return `剩余 ${Math.round(remainingPercent * 10) / 10}%`;
}

function QuotaRow({ quota, now, dimmed, canHide, onHide }: {
  quota: QuotaWindow;
  now: number;
  dimmed: boolean;
  canHide: boolean;
  onHide?: (id: string) => void;
}) {
  const members = Array.isArray(quota.members) ? quota.members.filter(member => member && typeof member.id === "string") : undefined;
  return (
    <div className={dimmed ? "opacity-60" : ""}>
      <div className="flex justify-between gap-3 text-xs mb-2">
        <span className="truncate" title={quota.id}>{quota.label}</span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="tabular-nums">{formatPercent(quota.remainingPercent)}</span>
          {canHide && (
            <button type="button" onClick={() => onHide?.(quota.id)}
              aria-label={`隐藏「${quota.label}」分组`} title="隐藏该分组"
              className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
      <div role="progressbar" aria-label={`${quota.label}剩余额度`} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={quota.remainingPercent} className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${progressColor(quota.remainingPercent)}`} style={{ width: `${quota.remainingPercent}%` }} />
      </div>
      <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground" title={quota.resetAt ? new Date(quota.resetAt).toLocaleString() : undefined}>
        <Clock3 className="h-3 w-3" aria-hidden="true" />{resetCountdown(quota.resetAt, now)}
      </div>
      {quota.inconsistent && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">组内额度不一致，汇总显示最低剩余额度；重置时间对应该模型</p>
      )}
      {members && members.length > 0 && (
        <details className="mt-1.5">
          <summary className="text-[11px] text-muted-foreground cursor-pointer select-none hover:text-foreground">
            成员明细（{members.length} 个模型）
          </summary>
          <ul className="mt-1 space-y-1 pl-1">
            {members.map(member => (
              <li key={member.id} className="flex justify-between gap-3 text-[11px]">
                <span className="truncate" title={member.label}>{member.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatPercent(member.remainingPercent)} · {resetCountdown(member.resetAt, now)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function QuotaCard({ provider, now }: { provider: ProviderQuota; now: number }) {
  const isAntigravity = provider.id === ANTIGRAVITY_ID;
  const quotas = provider.quotas;
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  // SSR / 首次渲染不读 localStorage：先按未隐藏渲染，effect 内加载后再套用偏好。
  const [hiddenReady, setHiddenReady] = useState(!isAntigravity);

  useEffect(() => {
    if (!isAntigravity) return;
    // localStorage 是外部系统：hydration 完成后加载已保存的隐藏偏好（避免 SSR 直接读存储造成 hydration 不一致）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(readHiddenQuotas(ANTIGRAVITY_ID));
    setHiddenReady(true);
  }, [isAntigravity]);

  const toggleHidden = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    // Persist only user actions, outside React's state updater.
    writeHiddenQuotas(ANTIGRAVITY_ID, [...next]);
  };

  const restoreAll = () => {
    setHidden(new Set());
    writeHiddenQuotas(ANTIGRAVITY_ID, []);
  };

  // Codex 等其余 provider 保持原显示：默认前四条，可展开；Antigravity 默认展示全部未隐藏分组。
  const visible = isAntigravity
    ? (hiddenReady ? quotas.filter(quota => !hidden.has(quota.id)) : quotas)
    : (expanded ? quotas : quotas.slice(0, 4));
  const hiddenQuotas = isAntigravity ? quotas.filter(quota => hidden.has(quota.id)) : [];
  const allHidden = isAntigravity && hiddenReady && quotas.length > 0 && hiddenQuotas.length === quotas.length;

  return (
    <article className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{provider.name}</h3>
        <span className="text-xs text-muted-foreground">{provider.plan ?? (provider.status === "ok" ? "已连接" : "暂不可用")}</span>
      </div>
      {provider.message && <p role="status" className="text-xs text-amber-600 dark:text-amber-400">{provider.message}</p>}
      {provider.stale && <p className="text-xs text-amber-600 dark:text-amber-400">以下为上次成功查询的数据，可能已过期</p>}
      {isAntigravity && <p className="text-[11px] text-muted-foreground">按模型家族汇总，取组内最低剩余额度，不代表各模型拥有独立额度池。周额度单独查询；可展开查看模型明细。</p>}
      <div className="space-y-4">
        {visible.map(quota => (
          <QuotaRow key={quota.id} quota={quota} now={now} dimmed={provider.stale} canHide={isAntigravity} onHide={toggleHidden} />
        ))}
      </div>
      {isAntigravity ? (
        allHidden ? (
          <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
            <p className="text-xs text-muted-foreground">所有 Antigravity 分组均已隐藏，恢复后可重新查看。</p>
            <div className="flex flex-wrap gap-1.5">
              {hiddenQuotas.map(quota => (
                <button key={quota.id} type="button" onClick={() => toggleHidden(quota.id)}
                  aria-label={`恢复显示「${quota.label}」分组`}
                  className="text-xs rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                  {quota.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={restoreAll} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
              恢复全部分组
            </button>
          </div>
        ) : hiddenQuotas.length > 0 ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">已隐藏 {hiddenQuotas.length} 个分组，点击可恢复：</p>
            <div className="flex flex-wrap gap-1.5">
              {hiddenQuotas.map(quota => (
                <button key={quota.id} type="button" onClick={() => toggleHidden(quota.id)}
                  aria-label={`恢复显示「${quota.label}」分组`} title={`恢复显示「${quota.label}」`}
                  className="text-xs rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                  {quota.label}
                </button>
              ))}
            </div>
          </div>
        ) : null
      ) : provider.quotas.length > 4 ? (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4">
          {expanded ? "收起模型额度" : `展开全部 ${provider.quotas.length} 项模型额度`}
        </button>
      ) : null}
      {provider.updatedAt && <p className="text-[11px] text-muted-foreground">上次成功查询：{new Date(provider.updatedAt).toLocaleString()}</p>}
    </article>
  );
}

export function ProviderQuotas() {
  const [data, setData] = useState<QuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(0);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async (force = false) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/quotas${force ? "?refresh=1" : ""}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Quota request failed");
      const result = await response.json() as QuotaResponse;
      if (!Array.isArray(result.providers)) throw new Error("Invalid quota response");
      if (!controller.signal.aborted) { setData(result); setError(false); setNow(Date.now()); }
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (active.current === controller) { active.current = null; if (!controller.signal.aborted) setLoading(false); }
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const refresh = setInterval(() => { if (!document.hidden) void load(); }, 5 * 60_000);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearTimeout(initial); clearInterval(refresh); clearInterval(clock); active.current?.abort(); active.current = null; };
  }, [load]);

  return (
    <section aria-label="供应商额度" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">供应商额度</h2>
          <p className="text-xs text-muted-foreground mt-1">账号剩余额度 · 每 5 分钟刷新 · 不受会话筛选影响</p>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs rounded-md border border-border px-3 py-1.5 hover:bg-secondary disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />{loading ? "查询中…" : "刷新额度"}
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">额度查询失败，请稍后重试。{data ? "以下为旧数据。" : ""}</p>}
      {data ? <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {data.providers.map(provider => <QuotaCard key={provider.id} provider={error ? { ...provider, stale: true } : provider} now={now} />)}
      </div> : loading ? <div role="status" className="rounded-xl border border-border p-6 text-sm text-muted-foreground">正在查询 Codex 和 Antigravity 额度…</div> : null}
      <p className="text-[11px] text-muted-foreground">额度比例由供应商返回，并非 Token 或请求次数；模型之间可能共享额度。不自动刷新或修改 Pi 登录凭据。</p>
    </section>
  );
}
