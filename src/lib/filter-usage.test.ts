import { describe, expect, it } from "vitest";
import { DEFAULT_USAGE_FILTERS, filterUsageData, getFilterOptions } from "./filter-usage";
import type { AggregatedData, MessageData, SessionData } from "./parse-sessions";

const now = new Date("2026-05-12T12:00:00Z").getTime();
const day = 86_400_000;
function message(timestamp: number, provider = "a", model = "shared"): MessageData {
  return {
    timestamp, provider, model,
    usage: {
      input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 100,
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
    },
  };
}
function fixture(messages: MessageData[], secondSession = false): AggregatedData {
  const session: SessionData = {
    sessionId: "one", sessionFile: "/one.jsonl", project: "/project",
    timestamp: "2026-01-01T00:00:00Z", lastInteraction: now,
    messages, totalUsage: message(now).usage,
    modelsUsed: ["shared"], providersUsed: ["a", "b"],
    assistantTurns: messages.length, userTurns: 7,
  };
  return {
    summary: {
      totalSessions: 1, totalUserTurns: 7, totalAssistantTurns: messages.length,
      totalTokens: 100, totalInputTokens: 10, totalOutputTokens: 20,
      totalCacheRead: 30, totalCacheWrite: 40, totalCost: 10,
      modelsUsed: 1, providersUsed: 2,
    },
    byModel: { shared: { tokens: 100, input: 10, output: 20, cacheRead: 30,
      cacheWrite: 40, cost: 10, turns: 1, sessions: 1, hasPricing: true } },
    byProject: {}, byDay: {}, byWeek: {}, byMonth: {},
    sessions: secondSession ? [session, { ...session, sessionId: "two" }] : [session],
  };
}

describe("filterUsageData", () => {
  it("preserves the complete original dataset when no filters apply", () => {
    const data = fixture([message(0)]);
    expect(filterUsageData(data, DEFAULT_USAGE_FILTERS, now)).toBe(data);
  });

  it.each([ ["24h", 1], ["7d", 7], ["30d", 30] ] as const)(
    "%s includes both time boundaries, excludes older, future and invalid messages",
    (dateRange, days) => {
      const start = now - days * day;
      const data = fixture([message(start - 1), message(start), message(now),
        message(now + 1), message(0), message(NaN), message(Infinity)]);
      const result = filterUsageData(data, { ...DEFAULT_USAGE_FILTERS, dateRange }, now);
      expect(result.sessions[0].messages.map((msg) => msg.timestamp)).toEqual([start, now]);
      expect(result.summary.totalTokens).toBe(200);
    },
  );

  it("uses local midnight for today rather than a rolling 24-hour window", () => {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const start = midnight.getTime();
    const result = filterUsageData(fixture([message(start - 1), message(start), message(now)]),
      { ...DEFAULT_USAGE_FILTERS, dateRange: "today" }, now);
    expect(result.sessions[0].messages.map((msg) => msg.timestamp)).toEqual([start, now]);
  });

  it("intersects time, provider and model and recomputes every usage total", () => {
    const data = fixture([message(now, "a"), message(now, "b"),
      message(now, "a", "other"), message(now - 8 * day, "a")]);
    const before = structuredClone(data);
    const result = filterUsageData(data,
      { dateRange: "7d", provider: "a", model: "shared" }, now);
    expect(result.summary).toEqual({
      totalSessions: 1, totalUserTurns: 7, totalAssistantTurns: 1,
      totalTokens: 100, totalInputTokens: 10, totalOutputTokens: 20,
      totalCacheRead: 30, totalCacheWrite: 40, totalCost: 10,
      modelsUsed: 1, providersUsed: 1,
    });
    expect(result.byModel.shared).toEqual(data.byModel.shared);
    expect(result.byProject["/project"]).toEqual({ tokens: 100, cost: 10, sessions: 1, turns: 1 });
    expect(result.sessions[0].totalUsage).toEqual(message(now).usage);
    expect(result.sessions[0].providersUsed).toEqual(["a"]);
    expect(result.sessions[0].modelsUsed).toEqual(["shared"]);
    expect(result.sessions[0].assistantTurns).toBe(1);
    expect(data).toEqual(before);
  });

  it("counts a session once per bucket/model, even across multiple days", () => {
    const data = fixture([message(now - day), message(now - day + 1), message(now)], true);
    const result = filterUsageData(data, { ...DEFAULT_USAGE_FILTERS, dateRange: "7d" }, now);
    expect(result.summary.totalSessions).toBe(2);
    expect(result.byModel.shared.sessions).toBe(2);
    expect(result.byDay["2026-05-11"].sessions).toBe(2);
    expect(result.byDay["2026-05-12"].sessions).toBe(2);
    expect(result.byWeek["2026-05-11"].sessions).toBe(2);
    expect(result.byMonth["2026-05"].sessions).toBe(2);
    expect(result.summary.totalTokens).toBe(600);
  });

  it("retains undated messages for all-time model/provider filters but not date buckets", () => {
    const result = filterUsageData(fixture([message(0)]),
      { ...DEFAULT_USAGE_FILTERS, provider: "a" }, now);
    expect(result.summary.totalTokens).toBe(100);
    expect(result.byDay).toEqual({});
    expect(result.byModel.shared.turns).toBe(1);
  });

  it("returns zero totals and empty collections when nothing matches", () => {
    const result = filterUsageData(fixture([message(now)]),
      { ...DEFAULT_USAGE_FILTERS, provider: "missing" }, now);
    expect(Object.values(result.summary).every((value) => value === 0)).toBe(true);
    expect(result.sessions).toEqual([]);
    expect(result.byModel).toEqual({});
    expect(result.byProject).toEqual({});
  });

  it("derives provider-dependent model options from all messages", () => {
    const data = fixture([message(now, "a"), message(now, "b", "exclusive"), message(now, "a")]);
    expect(getFilterOptions(data, "")).toEqual({ providers: ["a", "b"], models: ["exclusive", "shared"] });
    expect(getFilterOptions(data, "a")).toEqual({ providers: ["a", "b"], models: ["shared"] });
  });
});
