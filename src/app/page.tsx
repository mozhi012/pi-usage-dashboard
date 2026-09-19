"use client";

import { useState, useMemo, useEffect } from "react";
import { UsageFilters } from "@/components/usage-filters";
import {
  DEFAULT_USAGE_FILTERS,
  filterUsageData,
  getFilterOptions,
  hasUsageFilters,
  type UsageFilters as FilterState,
} from "@/lib/filter-usage";
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
  const { data, status, lastUpdated, syncing, sync } = useUsageStream();
  const [timeRange, setTimeRange] = useState<TimeRange>("daily");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_USAGE_FILTERS);
  const [clock, setClock] = useState(() => Date.now());

  // Advance rolling windows even when no new usage arrives.
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const now = Math.max(clock, lastUpdated?.getTime() ?? 0);
  const filteredData = useMemo(
    () => data ? filterUsageData(data, filters, now) : null,
    [data, filters, now],
  );
  const options = useMemo(
    () => data ? getFilterOptions(data, filters.provider) : { providers: [], models: [] },
    [data, filters.provider],
  );
  // Keep active selections visible if a live update removes their last message.
  const providers = filters.provider && !options.providers.includes(filters.provider)
    ? [...options.providers, filters.provider] : options.providers;
  const models = filters.model && !options.models.includes(filters.model)
    ? [...options.models, filters.model] : options.models;
  const isFiltered = hasUsageFilters(filters);

  function changeFilters(next: FilterState) {
    if (data && next.provider !== filters.provider && next.model &&
        !getFilterOptions(data, next.provider).models.includes(next.model)) {
      next = { ...next, model: "" };
    }
    setClock(Date.now());
    setFilters(next);
  }

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
        {!filteredData ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span>正在加载会话数据...</span>
            </div>
          </div>
        ) : (
          <>
            <UsageFilters
              filters={filters}
              providers={providers}
              models={models}
              onChange={changeFilters}
            />
            <SummaryCards summary={filteredData.summary} filtered={isFiltered} />
            {isFiltered && (
              <p className="text-xs text-muted-foreground">
                用量按匹配的助手消息统计；用户轮次为匹配会话的总用户轮次。今天按本地时间，其余时段为最近连续时长。
              </p>
            )}
            {filteredData.sessions.length === 0 && (
              <p role="status" className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                暂无匹配数据，请调整筛选条件。
              </p>
            )}

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
                    byDay={filteredData.byDay}
                    byWeek={filteredData.byWeek}
                    byMonth={filteredData.byMonth}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                  />
                  <TokensByModelChart byModel={filteredData.byModel} />
                </div>
              </TabsContent>

              <TabsContent value="models">
                <TokensByModelChart byModel={filteredData.byModel} fullWidth />
              </TabsContent>

              <TabsContent value="projects">
                <ProjectsTable byProject={filteredData.byProject} />
              </TabsContent>

              <TabsContent value="sessions">
                <SessionsTable sessions={filteredData.sessions} filtered={isFiltered} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
