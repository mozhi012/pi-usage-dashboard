"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export type TimeRange = "daily" | "weekly" | "monthly";

type TimeBucket = {
  tokens: number;
  input: number;
  output: number;
  cost: number;
  turns: number;
  sessions: number;
};

interface Props {
  byDay: Record<string, TimeBucket>;
  byWeek: Record<string, TimeBucket>;
  byMonth: Record<string, TimeBucket>;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatLabel(key: string, range: TimeRange): string {
  if (range === "monthly") {
    const d = new Date(key + "-01T00:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  if (range === "weekly") {
    const d = new Date(key + "T00:00:00Z");
    return "W " + d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  const d = new Date(key + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function TokensByDayChart({ byDay, byWeek, byMonth, timeRange, onTimeRangeChange }: Props) {
  const range = timeRange;

  const source = range === "weekly" ? byWeek : range === "monthly" ? byMonth : byDay;

  const data = Object.entries(source)
    .map(([key, stats]) => ({
      key,
      displayDate: formatLabel(key, range),
      tokens: stats.tokens,
      input: stats.input,
      output: stats.output,
      cost: stats.cost,
      turns: stats.turns,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Token Usage & Cost
          </CardTitle>
          <Tabs
            value={range}
            onValueChange={(v) => onTimeRangeChange(v as TimeRange)}
          >
            <TabsList className="h-7">
              <TabsTrigger value="daily" className="text-xs px-2 h-5">
                Daily
              </TabsTrigger>
              <TabsTrigger value="weekly" className="text-xs px-2 h-5">
                Weekly
              </TabsTrigger>
              <TabsTrigger value="monthly" className="text-xs px-2 h-5">
                Monthly
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <defs>
                <linearGradient id="inputGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="outputGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
              <XAxis dataKey="displayDate" fontSize={11} stroke="var(--muted-foreground)" />
              <YAxis
                yAxisId="tokens"
                tickFormatter={formatTokens}
                fontSize={11}
                stroke="var(--muted-foreground)"
              />
              <YAxis
                yAxisId="cost"
                orientation="right"
                tickFormatter={(v) => `$${v}`}
                fontSize={11}
                stroke="var(--muted-foreground)"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  fontSize: 12,
                  color: "var(--popover-foreground)",
                }}
                formatter={(value, name) => {
                  if (name === "cost") return [formatCost(value as number), "Cost"];
                  return [formatTokens(value as number), name === "input" ? "Input" : "Output"];
                }}
              />
              <Legend
                verticalAlign="top"
                height={28}
                formatter={(value) => {
                  if (value === "input") return "Input Tokens";
                  if (value === "output") return "Output Tokens";
                  if (value === "cost") return "Cost";
                  return value;
                }}
              />
              <Area
                yAxisId="tokens"
                type="monotone"
                dataKey="input"
                stroke="var(--chart-1)"
                fill="url(#inputGrad)"
                strokeWidth={2}
              />
              <Area
                yAxisId="tokens"
                type="monotone"
                dataKey="output"
                stroke="var(--chart-2)"
                fill="url(#outputGrad)"
                strokeWidth={2}
              />
              <Area
                yAxisId="cost"
                type="monotone"
                dataKey="cost"
                stroke="var(--chart-5)"
                fill="none"
                strokeWidth={2}
                strokeDasharray="5 3"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
