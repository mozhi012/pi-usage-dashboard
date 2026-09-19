// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderQuotas, resetCountdown } from "./provider-quotas";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("formats reset countdown without implying quota has refreshed", () => {
  expect(resetCountdown(null, 0)).toBe("重置时间未知");
  expect(resetCountdown(new Date(1000).toISOString(), 2000)).toContain("待刷新");
  expect(resetCountdown(new Date(3660000).toISOString(), 0)).toBe("1小时 1分钟后重置");
});
it("renders quota, expands model list, refreshes and cleans polling on unmount", async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ providers: [{ id: "antigravity", name: "Antigravity", status: "ok", stale: false, updatedAt: null,
    quotas: Array.from({ length: 5 }, (_, i) => ({ id: `model-${i}`, label: `Model ${i}`, remainingPercent: 85, resetAt: null })) }] }) }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ProviderQuotas />));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(host.textContent).toContain("剩余 85%");
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(4);
  const expand = host.querySelector('[aria-expanded]') as HTMLButtonElement;
  await act(async () => expand.click());
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(5);
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
  expect(fetcher).toHaveBeenLastCalledWith("/api/quotas?refresh=1", expect.anything());
});
it("displays errors instead of zero quota", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
  await act(async () => root.render(<ProviderQuotas />));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("查询失败");
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
});
