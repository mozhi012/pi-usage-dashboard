import type { AggregatedData, MessageData, UsageData } from "./parse-sessions";

export type DateRange = "all" | "today" | "24h" | "7d" | "30d";
export interface UsageFilters {
  dateRange: DateRange;
  provider: string;
  model: string;
}

export const DEFAULT_USAGE_FILTERS: UsageFilters = {
  dateRange: "all",
  provider: "",
  model: "",
};

export function hasUsageFilters(filters: UsageFilters): boolean {
  return filters.dateRange !== "all" || !!filters.provider || !!filters.model;
}

export function getFilterOptions(data: AggregatedData, provider: string) {
  const providers = new Set<string>();
  const models = new Set<string>();
  for (const session of data.sessions) {
    for (const message of session.messages) {
      providers.add(message.provider);
      if (!provider || message.provider === provider) models.add(message.model);
    }
  }
  return {
    providers: [...providers].filter(Boolean).sort(),
    models: [...models].filter(Boolean).sort(),
  };
}

function emptyUsage(): UsageData {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function addUsage(target: UsageData, usage: UsageData) {
  target.input += usage.input || 0;
  target.output += usage.output || 0;
  target.cacheRead += usage.cacheRead || 0;
  target.cacheWrite += usage.cacheWrite || 0;
  target.totalTokens += usage.totalTokens || 0;
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
    target.cost[key] += usage.cost?.[key] || 0;
  }
}

/** Filter assistant usage at message level; user turns are only available per session. */
export function filterUsageData(
  data: AggregatedData,
  filters: UsageFilters,
  now: number,
): AggregatedData {
  if (!hasUsageFilters(filters)) return data;

  let start = -Infinity;
  if (filters.dateRange === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    start = midnight.getTime();
  } else if (filters.dateRange !== "all") {
    const hours = { "24h": 24, "7d": 168, "30d": 720 }[filters.dateRange];
    start = now - hours * 60 * 60 * 1000;
  }
  const matches = (msg: MessageData) =>
    (!filters.provider || msg.provider === filters.provider) &&
    (!filters.model || msg.model === filters.model) &&
    (filters.dateRange === "all" || (
      !!msg.timestamp && Number.isFinite(new Date(msg.timestamp).getTime()) &&
      msg.timestamp >= start && msg.timestamp <= now
    ));

  const result: AggregatedData = {
    summary: {
      totalSessions: 0, totalUserTurns: 0, totalAssistantTurns: 0,
      totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0,
      totalCacheRead: 0, totalCacheWrite: 0, totalCost: 0,
      modelsUsed: 0, providersUsed: 0,
    },
    byModel: Object.create(null), byProject: Object.create(null),
    byDay: Object.create(null), byWeek: Object.create(null), byMonth: Object.create(null),
    sessions: [],
  };
  const allModels = new Set<string>();
  const allProviders = new Set<string>();
  const total = emptyUsage();

  for (const session of data.sessions) {
    const messages = session.messages.filter(matches);
    if (!messages.length) continue;
    const usage = emptyUsage();
    const models = new Set<string>();
    const providers = new Set<string>();
    const days = new Set<string>();
    const weeks = new Set<string>();
    const months = new Set<string>();
    let lastInteraction = 0;

    for (const msg of messages) {
      addUsage(usage, msg.usage);
      models.add(msg.model);
      providers.add(msg.provider);
      allModels.add(msg.model);
      allProviders.add(msg.provider);
      const model = result.byModel[msg.model] ??= {
        tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        cost: 0, turns: 0, sessions: 0,
        hasPricing: data.byModel[msg.model]?.hasPricing ?? false,
      };
      model.tokens += msg.usage.totalTokens || 0;
      model.input += msg.usage.input || 0;
      model.output += msg.usage.output || 0;
      model.cacheRead += msg.usage.cacheRead || 0;
      model.cacheWrite += msg.usage.cacheWrite || 0;
      model.cost += msg.usage.cost?.total || 0;
      model.turns++;

      const date = new Date(msg.timestamp);
      if (!msg.timestamp || !Number.isFinite(date.getTime())) continue;
      lastInteraction = Math.max(lastInteraction, msg.timestamp);
      const day = date.toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      const week = date.toISOString().slice(0, 10);
      const buckets = [
        [result.byDay, day, days],
        [result.byWeek, week, weeks],
        [result.byMonth, month, months],
      ] as const;
      for (const [record, key, seen] of buckets) {
        const bucket = record[key] ??= {
          tokens: 0, input: 0, output: 0, cost: 0, turns: 0, sessions: 0,
        };
        bucket.tokens += msg.usage.totalTokens || 0;
        bucket.input += msg.usage.input || 0;
        bucket.output += msg.usage.output || 0;
        bucket.cost += msg.usage.cost?.total || 0;
        bucket.turns++;
        if (!seen.has(key)) bucket.sessions++;
        seen.add(key);
      }
    }
    for (const model of models) result.byModel[model].sessions++;
    const project = result.byProject[session.project] ??= {
      tokens: 0, cost: 0, sessions: 0, turns: 0,
    };
    project.tokens += usage.totalTokens;
    project.cost += usage.cost.total;
    project.sessions++;
    project.turns += messages.length;
    result.sessions.push({
      ...session, messages, totalUsage: usage,
      modelsUsed: [...models], providersUsed: [...providers],
      assistantTurns: messages.length, lastInteraction,
    });
    result.summary.totalUserTurns += session.userTurns;
    result.summary.totalAssistantTurns += messages.length;
    addUsage(total, usage);
  }
  result.sessions.sort((a, b) => b.lastInteraction - a.lastInteraction);
  Object.assign(result.summary, {
    totalSessions: result.sessions.length,
    totalTokens: total.totalTokens, totalInputTokens: total.input,
    totalOutputTokens: total.output, totalCacheRead: total.cacheRead,
    totalCacheWrite: total.cacheWrite, totalCost: total.cost.total,
    modelsUsed: allModels.size, providersUsed: allProviders.size,
  });
  return result;
}
