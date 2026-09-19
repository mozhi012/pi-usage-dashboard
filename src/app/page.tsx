"use client";

import { useState, useMemo } from "react";
import { useUsageStream } from "@/hooks/use-usage-stream";
import { SummaryCards } from "@/components/summary-cards";
import { TokensByModelChart } from "@/components/tokens-by-model-chart";
import { TokensByDayChart } from "@/components/tokens-by-day-chart";
import { ProjectsTable } from "@/components/projects-table";
import { SessionsTable } from "@/components/sessions-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  BarChart3,
  FolderOpen,
  History,
  RefreshCw,
  Wifi,
  WifiOff,
  DollarSign,
  Settings,
  Puzzle,
  Cpu,
  Keyboard,
} from "lucide-react";
import Link from "next/link";

type TimeRange = "daily" | "weekly" | "monthly";

export default function Home() {
  const { data, status, lastUpdated, syncing, refresh, sync } = useUsageStream();
  const [timeRange, setTimeRange] = useState<TimeRange>("daily");

  // Helper: get the time bucket key for a timestamp
  const getTimeKey = (timestamp: number, range: TimeRange): string => {
    const d = new Date(timestamp);
    if (range === "monthly") {
      return d.toISOString().slice(0, 7); // YYYY-MM
    }
    if (range === "weekly") {
      const dayOfWeek = d.getUTCDay();
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((dayOfWeek + 6) % 7));
      return monday.toISOString().split("T")[0];
    }
    return d.toISOString().split("T")[0]; // YYYY-MM-DD
  };

  // Compute filtered summary based on selected time range
  const filteredSummary = useMemo(() => {
    if (!data) return null;

    const source =
      timeRange === "weekly"
        ? data.byWeek
        : timeRange === "monthly"
        ? data.byMonth
        : data.byDay;

    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let totalTurns = 0;
    let totalSessions = 0;

    for (const bucket of Object.values(source)) {
      totalTokens += bucket.tokens;
      totalInput += bucket.input;
      totalOutput += bucket.output;
      totalCost += bucket.cost;
      totalTurns += bucket.turns;
      totalSessions += bucket.sessions;
    }

    return {
      ...data.summary,
      totalTokens,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCost,
      totalAssistantTurns: totalTurns,
      totalSessions,
    };
  }, [data, timeRange]);

  // Compute byModel filtered by time range
  const filteredByModel = useMemo(() => {
    if (!data) return {} as NonNullable<typeof data>["byModel"];

    // Get the set of valid time keys for the current range
    const source =
      timeRange === "weekly"
        ? data.byWeek
        : timeRange === "monthly"
        ? data.byMonth
        : data.byDay;
    const validKeys = new Set(Object.keys(source));

    // Rebuild byModel from session messages filtered by time range
    const byModel: typeof data.byModel = {};
    const sessionsByModel = new Map<string, Set<string>>();

    for (const session of data.sessions) {
      for (const msg of session.messages) {
        if (!msg.timestamp) continue;
        const key = getTimeKey(msg.timestamp, timeRange);
        if (!validKeys.has(key)) continue;

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
            hasPricing: data.byModel[msg.model]?.hasPricing ?? false,
          };
          sessionsByModel.set(msg.model, new Set());
        }

        byModel[msg.model].tokens += msg.usage.totalTokens || 0;
        byModel[msg.model].input += msg.usage.input || 0;
        byModel[msg.model].output += msg.usage.output || 0;
        byModel[msg.model].cacheRead += msg.usage.cacheRead || 0;
        byModel[msg.model].cacheWrite += msg.usage.cacheWrite || 0;
        byModel[msg.model].cost += msg.usage.cost?.total || 0;
        byModel[msg.model].turns++;
        sessionsByModel.get(msg.model)!.add(session.sessionId);
      }
    }

    // Set session counts
    for (const [model, sessions] of sessionsByModel) {
      if (byModel[model]) byModel[model].sessions = sessions.size;
    }

    return byModel;
  }, [data, timeRange]);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Pi 用量仪表盘
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                全量会话的 Token 用量与费用追踪
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Connection status indicator */}
              <div className="flex items-center gap-1.5">
                {status === "connected" ? (
                  <Wifi className="h-3.5 w-3.5 text-green-500" />
                ) : status === "connecting" ? (
                  <Wifi className="h-3.5 w-3.5 text-yellow-500 animate-pulse" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-red-500" />
                )}
                <span className="text-xs text-muted-foreground">
                  {status === "connected"
                    ? "实时在线"
                    : status === "connecting"
                    ? "连接中..."
                    : "已断开"}
                </span>
              </div>

              {lastUpdated && (
                <span className="text-xs text-muted-foreground">
                  更新于 {lastUpdated.toLocaleTimeString()}
                </span>
              )}
              <Link
                href="/models"
                className="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <Cpu className="h-3.5 w-3.5" />
                模型
              </Link>
              <Link
                href="/hotkeys"
                className="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <Keyboard className="h-3.5 w-3.5" />
                快捷键
              </Link>
              <Link
                href="/extensions"
                className="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <Puzzle className="h-3.5 w-3.5" />
                扩展
              </Link>
              <Link
                href="/settings"
                className="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <Settings className="h-3.5 w-3.5" />
                数据源
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <DollarSign className="h-3.5 w-3.5" />
                定价
              </Link>
              <button
                onClick={sync}
                disabled={syncing}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
                />
                同步数据
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-6 py-6 space-y-6">
        {!data ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span>正在加载会话数据...</span>
            </div>
          </div>
        ) : (
          <>
            <SummaryCards
              summary={filteredSummary ?? data.summary}
              timeRange={timeRange}
            />

            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview" className="gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  概览
                </TabsTrigger>
                <TabsTrigger value="models" className="gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" />
                  模型分布
                </TabsTrigger>
                <TabsTrigger value="projects" className="gap-1.5">
                  <FolderOpen className="h-3.5 w-3.5" />
                  项目列表
                </TabsTrigger>
                <TabsTrigger value="sessions" className="gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  会话列表
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <TokensByDayChart
                    byDay={data.byDay}
                    byWeek={data.byWeek}
                    byMonth={data.byMonth}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                  />
                  <TokensByModelChart byModel={filteredByModel} />
                </div>
              </TabsContent>

              <TabsContent value="models">
                <TokensByModelChart byModel={filteredByModel} fullWidth />
              </TabsContent>

              <TabsContent value="projects">
                <ProjectsTable byProject={data.byProject} />
              </TabsContent>

              <TabsContent value="sessions">
                <SessionsTable sessions={data.sessions} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
