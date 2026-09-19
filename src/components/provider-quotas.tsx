"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, RefreshCw } from "lucide-react";
import type { ProviderQuota, QuotaResponse } from "@/lib/quota-types";

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

function QuotaCard({ provider, now }: { provider: ProviderQuota; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? provider.quotas : provider.quotas.slice(0, 4);
  return (
    <article className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{provider.name}</h3>
        <span className="text-xs text-muted-foreground">{provider.plan ?? (provider.status === "ok" ? "已连接" : "暂不可用")}</span>
      </div>
      {provider.message && <p role="status" className="text-xs text-amber-600 dark:text-amber-400">{provider.message}</p>}
      {provider.stale && <p className="text-xs text-amber-600 dark:text-amber-400">以下为上次成功查询的数据，可能已过期</p>}
      <div className="space-y-4">
        {visible.map(quota => {
          const color = quota.remainingPercent <= 10 ? "bg-red-500" : quota.remainingPercent <= 30 ? "bg-amber-500" : "bg-emerald-500";
          return (
            <div key={quota.id} className={provider.stale ? "opacity-60" : ""}>
              <div className="flex justify-between gap-3 text-xs mb-2">
                <span className="truncate" title={quota.id}>{quota.label}</span>
                <span className="shrink-0 tabular-nums">剩余 {Math.round(quota.remainingPercent * 10) / 10}%</span>
              </div>
              <div role="progressbar" aria-label={`${quota.label}剩余额度`} aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={quota.remainingPercent} className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${quota.remainingPercent}%` }} />
              </div>
              <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground" title={quota.resetAt ? new Date(quota.resetAt).toLocaleString() : undefined}>
                <Clock3 className="h-3 w-3" />{resetCountdown(quota.resetAt, now)}
              </div>
            </div>
          );
        })}
      </div>
      {provider.quotas.length > 4 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4">
        {expanded ? "收起模型额度" : `展开全部 ${provider.quotas.length} 项模型额度`}
      </button>}
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
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />{loading ? "查询中…" : "刷新额度"}
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
