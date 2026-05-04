/**
 * Session Parser
 *
 * Reads pi session JSONL files from all configured sources, extracts usage data,
 * applies custom pricing, and returns aggregated statistics.
 *
 * Supports multiple session sources with deduplication by session ID.
 * Compatible with pi's session format (v3) including compacted sessions.
 */
import { readdir, readFile, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { getPricingMap, calculateCost, type ModelPricing } from "./db";
import { getSessionDirs } from "./session-paths";

export interface UsageData {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface MessageData {
  model: string;
  provider: string;
  usage: UsageData;
  timestamp: number;
}

export interface SessionData {
  sessionId: string;
  sessionFile: string; // Full path to the .jsonl file
  project: string;
  timestamp: string;
  lastInteraction: number; // Unix ms of last message
  messages: MessageData[];
  totalUsage: UsageData;
  modelsUsed: string[];
  providersUsed: string[];
  assistantTurns: number;
  userTurns: number;
}

export interface AggregatedData {
  summary: {
    totalSessions: number;
    totalUserTurns: number;
    totalAssistantTurns: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheRead: number;
    totalCacheWrite: number;
    totalCost: number;
    modelsUsed: number;
    providersUsed: number;
  };
  byModel: Record<
    string,
    {
      tokens: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      cost: number;
      turns: number;
      sessions: number;
      hasPricing: boolean;
    }
  >;
  byProject: Record<
    string,
    {
      tokens: number;
      cost: number;
      sessions: number;
      turns: number;
    }
  >;
  byDay: Record<
    string,
    {
      tokens: number;
      input: number;
      output: number;
      cost: number;
      turns: number;
      sessions: number;
    }
  >;
  byWeek: Record<
    string,
    {
      tokens: number;
      input: number;
      output: number;
      cost: number;
      turns: number;
      sessions: number;
    }
  >;
  byMonth: Record<
    string,
    {
      tokens: number;
      input: number;
      output: number;
      cost: number;
      turns: number;
      sessions: number;
    }
  >;
  sessions: SessionData[];
}

function shortenProject(project: string): string {
  const home = homedir();
  // Must match home exactly or followed by a path separator to avoid
  // false positives (e.g. home="/Users/john", project="/Users/johnson/proj")
  if (project === home) {
    return "~";
  }
  if (project.startsWith(home + "/") || project.startsWith(home + "\\")) {
    return "~" + project.slice(home.length);
  }
  return project;
}

async function parseSessionFile(
  filepath: string,
  pricingMap: Map<string, ModelPricing>
): Promise<SessionData | null> {
  try {
    const content = await readFile(filepath, "utf-8");
    const lines = content.trim().split("\n");

    let lastInteraction = 0;

    const session: SessionData = {
      sessionId: "",
      sessionFile: filepath,
      project: "unknown",
      timestamp: "",
      lastInteraction: 0,
      messages: [],
      totalUsage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      modelsUsed: [],
      providersUsed: [],
      assistantTurns: 0,
      userTurns: 0,
    };

    const modelsSet = new Set<string>();
    const providersSet = new Set<string>();

    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);

        if (entry.type === "session") {
          session.sessionId = entry.id || "";
          session.timestamp = entry.timestamp || "";
          session.project = shortenProject(entry.cwd || "unknown");
        }

        if (entry.type === "message") {
          const msg = entry.message;
          if (!msg) continue;

          // Track last interaction from any message timestamp
          const msgTs = msg.timestamp || 0;
          if (msgTs > lastInteraction) lastInteraction = msgTs;

          if (msg.role === "user") {
            session.userTurns++;
          }

          if (msg.role === "assistant" && msg.usage) {
            session.assistantTurns++;
            const usage = msg.usage;
            const model = msg.model || "unknown";
            const provider = msg.provider || "unknown";

            modelsSet.add(model);
            providersSet.add(provider);

            session.totalUsage.input += usage.input || 0;
            session.totalUsage.output += usage.output || 0;
            session.totalUsage.cacheRead += usage.cacheRead || 0;
            session.totalUsage.cacheWrite += usage.cacheWrite || 0;
            session.totalUsage.totalTokens += usage.totalTokens || 0;

            // Calculate cost: use custom pricing if available, else use provider-reported cost
            const pricing = pricingMap.get(model);
            let cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };

            if (pricing && (pricing.inputPrice > 0 || pricing.outputPrice > 0 || pricing.cacheReadPrice > 0 || pricing.cacheWritePrice > 0)) {
              cost = calculateCost(
                {
                  input: usage.input || 0,
                  output: usage.output || 0,
                  cacheRead: usage.cacheRead || 0,
                  cacheWrite: usage.cacheWrite || 0,
                },
                pricing
              );
            } else {
              const rawCost = usage.cost || {};
              cost = {
                input: rawCost.input || 0,
                output: rawCost.output || 0,
                cacheRead: rawCost.cacheRead || 0,
                cacheWrite: rawCost.cacheWrite || 0,
                total: rawCost.total || 0,
              };
            }

            session.totalUsage.cost.input += cost.input;
            session.totalUsage.cost.output += cost.output;
            session.totalUsage.cost.cacheRead += cost.cacheRead;
            session.totalUsage.cost.cacheWrite += cost.cacheWrite;
            session.totalUsage.cost.total += cost.total;

            session.messages.push({
              model,
              provider,
              usage: {
                ...usage,
                cost,
              },
              timestamp: msg.timestamp || 0,
            });
          }
        }
      } catch {
        continue;
      }
    }

    session.modelsUsed = Array.from(modelsSet);
    session.providersUsed = Array.from(providersSet);
    session.lastInteraction = lastInteraction || new Date(session.timestamp).getTime() || 0;

    if (session.assistantTurns === 0) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Collect all .jsonl files from a session directory.
 * Supports two structures:
 * 1. Pi default: sessions/<project-dir>/<file>.jsonl
 * 2. Flat or nested: sessions/<any-depth>/<file>.jsonl
 */
async function collectSessionFiles(baseDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.name.endsWith(".jsonl")) {
          files.push(fullPath);
        }
      }
    } catch {
      // skip inaccessible dirs
    }
  }

  await walk(baseDir);
  return files;
}

export async function getAllUsageData(): Promise<AggregatedData> {
  const sessionDirs = getSessionDirs();
  const pricingMap = getPricingMap();

  const allSessions: SessionData[] = [];
  const seenSessionIds = new Set<string>();

  for (const baseDir of sessionDirs) {
    // Check if directory exists
    try {
      await access(baseDir);
    } catch {
      continue;
    }

    const sessionFiles = await collectSessionFiles(baseDir);

    for (const filepath of sessionFiles) {
      const session = await parseSessionFile(filepath, pricingMap);
      if (!session) continue;

      // Deduplicate by session ID (same session might appear in multiple sources)
      if (session.sessionId && seenSessionIds.has(session.sessionId)) {
        continue;
      }
      if (session.sessionId) {
        seenSessionIds.add(session.sessionId);
      }

      allSessions.push(session);
    }
  }

  // Aggregate
  const allModels = new Set<string>();
  const allProviders = new Set<string>();
  const byModel: AggregatedData["byModel"] = {};
  const byProject: AggregatedData["byProject"] = {};
  const byDay: AggregatedData["byDay"] = {};
  const byWeek: AggregatedData["byWeek"] = {};
  const byMonth: AggregatedData["byMonth"] = {};

  for (const session of allSessions) {
    session.modelsUsed.forEach((m) => allModels.add(m));
    session.providersUsed.forEach((p) => allProviders.add(p));

    // By project
    const project = session.project;
    if (!byProject[project]) {
      byProject[project] = { tokens: 0, cost: 0, sessions: 0, turns: 0 };
    }
    byProject[project].tokens += session.totalUsage.totalTokens;
    byProject[project].cost += session.totalUsage.cost.total;
    byProject[project].sessions++;
    byProject[project].turns += session.assistantTurns;

    // By model and by day
    for (const msg of session.messages) {
      // By model
      if (!byModel[msg.model]) {
        byModel[msg.model] = {
          tokens: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          turns: 0,
          sessions: 0,
          hasPricing: pricingMap.has(msg.model),
        };
      }
      byModel[msg.model].tokens += msg.usage.totalTokens || 0;
      byModel[msg.model].input += msg.usage.input || 0;
      byModel[msg.model].output += msg.usage.output || 0;
      byModel[msg.model].cacheRead += msg.usage.cacheRead || 0;
      byModel[msg.model].cacheWrite += msg.usage.cacheWrite || 0;
      byModel[msg.model].cost += msg.usage.cost?.total || 0;
      byModel[msg.model].turns++;

      // By day, week, month
      if (msg.timestamp) {
        try {
          const d = new Date(msg.timestamp);
          const date = d.toISOString().split("T")[0];

          // By day
          if (!byDay[date]) {
            byDay[date] = { tokens: 0, input: 0, output: 0, cost: 0, turns: 0, sessions: 0 };
          }
          byDay[date].tokens += msg.usage.totalTokens || 0;
          byDay[date].input += msg.usage.input || 0;
          byDay[date].output += msg.usage.output || 0;
          byDay[date].cost += msg.usage.cost?.total || 0;
          byDay[date].turns++;

          // By week (ISO week starting Monday)
          const dayOfWeek = d.getUTCDay();
          const monday = new Date(d);
          monday.setUTCDate(d.getUTCDate() - ((dayOfWeek + 6) % 7));
          const weekKey = monday.toISOString().split("T")[0];
          if (!byWeek[weekKey]) {
            byWeek[weekKey] = { tokens: 0, input: 0, output: 0, cost: 0, turns: 0, sessions: 0 };
          }
          byWeek[weekKey].tokens += msg.usage.totalTokens || 0;
          byWeek[weekKey].input += msg.usage.input || 0;
          byWeek[weekKey].output += msg.usage.output || 0;
          byWeek[weekKey].cost += msg.usage.cost?.total || 0;
          byWeek[weekKey].turns++;

          // By month
          const monthKey = date.slice(0, 7); // YYYY-MM
          if (!byMonth[monthKey]) {
            byMonth[monthKey] = { tokens: 0, input: 0, output: 0, cost: 0, turns: 0, sessions: 0 };
          }
          byMonth[monthKey].tokens += msg.usage.totalTokens || 0;
          byMonth[monthKey].input += msg.usage.input || 0;
          byMonth[monthKey].output += msg.usage.output || 0;
          byMonth[monthKey].cost += msg.usage.cost?.total || 0;
          byMonth[monthKey].turns++;
        } catch {
          // skip
        }
      }
    }
  }

  // Count sessions per model
  for (const session of allSessions) {
    for (const model of session.modelsUsed) {
      if (byModel[model]) byModel[model].sessions++;
    }
  }

  // Count sessions per day, week, month
  for (const session of allSessions) {
    if (session.timestamp) {
      try {
        const d = new Date(session.timestamp);
        const date = d.toISOString().split("T")[0];
        if (byDay[date]) byDay[date].sessions++;

        // By week
        const dayOfWeek = d.getUTCDay();
        const monday = new Date(d);
        monday.setUTCDate(d.getUTCDate() - ((dayOfWeek + 6) % 7));
        const weekKey = monday.toISOString().split("T")[0];
        if (byWeek[weekKey]) byWeek[weekKey].sessions++;

        // By month
        const monthKey = date.slice(0, 7);
        if (byMonth[monthKey]) byMonth[monthKey].sessions++;
      } catch {
        // skip
      }
    }
  }

  const summary = {
    totalSessions: allSessions.length,
    totalUserTurns: allSessions.reduce((a, s) => a + s.userTurns, 0),
    totalAssistantTurns: allSessions.reduce(
      (a, s) => a + s.assistantTurns,
      0
    ),
    totalTokens: allSessions.reduce(
      (a, s) => a + s.totalUsage.totalTokens,
      0
    ),
    totalInputTokens: allSessions.reduce((a, s) => a + s.totalUsage.input, 0),
    totalOutputTokens: allSessions.reduce(
      (a, s) => a + s.totalUsage.output,
      0
    ),
    totalCacheRead: allSessions.reduce(
      (a, s) => a + s.totalUsage.cacheRead,
      0
    ),
    totalCacheWrite: allSessions.reduce(
      (a, s) => a + s.totalUsage.cacheWrite,
      0
    ),
    totalCost: allSessions.reduce(
      (a, s) => a + s.totalUsage.cost.total,
      0
    ),
    modelsUsed: allModels.size,
    providersUsed: allProviders.size,
  };

  // Sort sessions by last interaction descending
  allSessions.sort((a, b) => b.lastInteraction - a.lastInteraction);

  return { summary, byModel, byProject, byDay, byWeek, byMonth, sessions: allSessions };
}
