// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProviderQuota } from "@/lib/quota-types";
import { ProviderQuotas, resetCountdown } from "./provider-quotas";

const HIDDEN_KEY = "pi-usage-dashboard:hidden-quotas:antigravity";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function antigravity(overrides: Partial<ProviderQuota> = {}): ProviderQuota {
  return {
    id: "antigravity", name: "Antigravity", status: "ok", stale: false, updatedAt: null,
    quotas: [
      { id: "gemini", label: "Gemini 家族", remainingPercent: 85, resetAt: new Date(Date.now() + 3_600_000).toISOString() },
      { id: "claude", label: "Claude 家族", remainingPercent: 40, resetAt: null },
      { id: "gemini_weekly", label: "Gemini 周额度", remainingPercent: 66, resetAt: null },
      { id: "claude_gpt_weekly", label: "Claude/GPT 周额度", remainingPercent: 20, resetAt: null },
      { id: "images", label: "图片生成", remainingPercent: 90, resetAt: null },
    ],
    ...overrides,
  };
}

function codex(count = 5): ProviderQuota {
  return {
    id: "openai-codex", name: "Codex", status: "ok", stale: false, updatedAt: null,
    quotas: Array.from({ length: count }, (_, i) => ({ id: `model-${i}`, label: `Model ${i}`, remainingPercent: 85, resetAt: null })),
  };
}

function quotaFetch(providers: ProviderQuota[]) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ providers }) }));
}

async function renderLoaded(fetcher: ReturnType<typeof quotaFetch>) {
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ProviderQuotas />));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text));
  expect(button, `button with text ${text}`).toBeTruthy();
  return button as HTMLButtonElement;
}

it("formats reset countdown without implying quota has refreshed", () => {
  expect(resetCountdown(null, 0)).toBe("重置时间未知");
  expect(resetCountdown(new Date(1000).toISOString(), 2000)).toContain("待刷新");
  expect(resetCountdown(new Date(3660000).toISOString(), 0)).toBe("1小时 1分钟后重置");
});

it("shows every Antigravity group by default with family note and hide buttons", async () => {
  await renderLoaded(quotaFetch([antigravity()]));
  expect(host.textContent).toContain("剩余 85%");
  expect(host.textContent).toContain("按模型家族汇总");
  expect(host.textContent).toContain("并非 Token 或请求次数");
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(5);
  expect(host.querySelectorAll('button[aria-label^="隐藏「"]')).toHaveLength(5);
  expect(host.querySelector('button[aria-expanded]')).toBeNull();
});

it("expands member details and shows inconsistent note", async () => {
  const provider = antigravity({
    quotas: [{
      id: "gemini", label: "Gemini 家族", remainingPercent: 55, resetAt: new Date(Date.now() + 7_200_000).toISOString(), inconsistent: true,
      members: [
        { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", remainingPercent: 55, resetAt: new Date(Date.now() + 7_200_000).toISOString() },
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", remainingPercent: 88, resetAt: null },
      ],
    }],
  });
  await renderLoaded(quotaFetch([provider]));
  expect(host.textContent).toContain("组内额度不一致，汇总显示最低剩余额度；重置时间对应该模型");
  const summary = host.querySelector("details summary") as HTMLElement;
  expect(summary.textContent).toContain("成员明细（2 个模型）");
  await act(async () => summary.click());
  const details = host.querySelector("details") as HTMLDetailsElement;
  expect(details.open).toBe(true);
  expect(details.textContent).toContain("Gemini 2.5 Pro");
  expect(details.textContent).toContain("剩余 55%");
  expect(details.textContent).toContain("2小时 0分钟后重置");
  expect(details.textContent).toContain("剩余 88%");
  expect(details.textContent).toContain("重置时间未知");
});

it("hides a group, restores it, and keeps the preference after remount", async () => {
  await renderLoaded(quotaFetch([antigravity()]));
  const hide = host.querySelector('button[aria-label="隐藏「Gemini 家族」分组"]') as HTMLButtonElement;
  await act(async () => hide.click());
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(4);
  expect(host.textContent).toContain("已隐藏 1 个分组");
  expect(localStorage.getItem(HIDDEN_KEY)).toBe(JSON.stringify(["gemini"]));

  const restore = host.querySelector('button[aria-label="恢复显示「Gemini 家族」分组"]') as HTMLButtonElement;
  await act(async () => restore.click());
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(5);
  expect(localStorage.getItem(HIDDEN_KEY)).toBe("[]");

  await act(async () => (host.querySelector('button[aria-label="隐藏「Gemini 家族」分组"]') as HTMLButtonElement).click());
  expect(localStorage.getItem(HIDDEN_KEY)).toBe(JSON.stringify(["gemini"]));
  await act(async () => root.unmount());
  const host2 = document.createElement("div");
  document.body.append(host2);
  const root2 = createRoot(host2);
  await act(async () => root2.render(<ProviderQuotas />));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(host2.querySelectorAll('[role="progressbar"]')).toHaveLength(4);
  await act(async () => root2.unmount());
  host2.remove();
});

it("explains and recovers when all Antigravity groups are hidden", async () => {
  await renderLoaded(quotaFetch([antigravity()]));
  for (const label of ["Gemini 家族", "Claude 家族", "Gemini 周额度", "Claude/GPT 周额度", "图片生成"]) {
    await act(async () => (host.querySelector(`button[aria-label="隐藏「${label}」分组"]`) as HTMLButtonElement).click());
  }
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  expect(host.textContent).toContain("所有 Antigravity 分组均已隐藏");
  const restoreAll = buttonByText("恢复全部分组");
  await act(async () => restoreAll.click());
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(5);
  expect(localStorage.getItem(HIDDEN_KEY)).toBe("[]");
});

it.each(["{corrupt json", JSON.stringify({ not: "an array" }), "disabled"])("tolerates invalid or disabled localStorage: %s", async stored => {
  if (stored === "disabled") {
    const failing = () => { throw new Error("storage disabled"); };
    vi.stubGlobal("localStorage", { getItem: failing, setItem: failing });
  } else {
    localStorage.setItem(HIDDEN_KEY, stored);
  }
  await renderLoaded(quotaFetch([antigravity()]));
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(5);
  const hide = host.querySelector('button[aria-label="隐藏「图片生成」分组"]') as HTMLButtonElement;
  await act(async () => hide.click());
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(4);
});

it("does not let refresh requests overwrite hidden preferences", async () => {
  const fetcher = quotaFetch([antigravity()]);
  await renderLoaded(fetcher);
  const hide = host.querySelector('button[aria-label="隐藏「Claude 家族」分组"]') as HTMLButtonElement;
  await act(async () => hide.click());
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(4);

  await act(async () => buttonByText("刷新额度").click());
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetcher).toHaveBeenLastCalledWith("/api/quotas?refresh=1", expect.anything());
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(4);
  expect(localStorage.getItem(HIDDEN_KEY)).toBe(JSON.stringify(["claude"]));
});

it("keeps Codex display unchanged: first four, expand, no hide controls", async () => {
  const fetcher = quotaFetch([codex(5)]);
  await renderLoaded(fetcher);
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(4);
  expect(host.querySelectorAll('button[aria-label^="隐藏「"]')).toHaveLength(0);
  const expand = host.querySelector('button[aria-expanded]') as HTMLButtonElement;
  expect(expand.textContent).toContain("展开全部 5 项模型额度");
  await act(async () => expand.click());
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(5);
  expect(localStorage.getItem(HIDDEN_KEY)).toBeNull();
});

it("renders quota, refreshes and cleans polling on unmount", async () => {
  const fetcher = quotaFetch([codex(5)]);
  await renderLoaded(fetcher);
  expect(host.textContent).toContain("剩余 85%");
  const firstCalls = fetcher.mock.calls.length;
  await act(async () => buttonByText("刷新额度").click());
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetcher).toHaveBeenCalledTimes(firstCalls + 1);
  expect(fetcher).toHaveBeenLastCalledWith("/api/quotas?refresh=1", expect.anything());
});

it("displays errors instead of zero quota", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
  await act(async () => root.render(<ProviderQuotas />));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("查询失败");
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
});
