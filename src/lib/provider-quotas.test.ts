import { describe, expect, it, vi } from "vitest";
import { createQuotaService, parseQuotas } from "./provider-quotas";

const raw = { rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1790000000 }, secondary_window: { used_percent: 2, limit_window_seconds: 604800 } } };
function fixture() {
  let now = 1780000000000;
  let auth: unknown = { "openai-codex": { type: "oauth", access: "SECRET", expires: now + 86400000 }, antigravity: { type: "oauth", access: "GOOGLE_SECRET", expires: now + 86400000 } };
  const request = vi.fn(async () => ({ status: 200, data: raw }));
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
  it("filters internal models and preserves valid zero while clamping", () => {
    const models = {
      "gemini-zero": { quotaInfo: { remainingFraction: 0, resetTime: "invalid" } },
      "claude-full": { displayName: "Claude", quotaInfo: { remainingFraction: 1.2 } },
      "gpt-hidden": { isInternal: true, quotaInfo: { remainingFraction: 1 } },
      "tab-internal": { quotaInfo: { remainingFraction: 1 } },
      "gemini-missing": { quotaInfo: {} },
    };
    const q = parseQuotas("antigravity", { models });
    expect(q).toHaveLength(2);
    expect(q.find(q => q.id === "gemini-zero")).toMatchObject({ remainingPercent: 0, resetAt: null });
    expect(q.find(q => q.id === "claude-full")?.remainingPercent).toBe(100);
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
});
