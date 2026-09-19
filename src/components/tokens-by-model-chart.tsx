"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";

interface Props {
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
  fullWidth?: boolean;
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

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function TokensByModelChart({ byModel, fullWidth }: Props) {
  const data = Object.entries(byModel)
    .map(([model, stats]) => ({
      model: model.length > 20 ? model.slice(0, 18) + "…" : model,
      fullModel: model,
      tokens: stats.tokens,
      input: stats.input,
      output: stats.output,
      cost: stats.cost,
      turns: stats.turns,
      sessions: stats.sessions,
      hasPricing: stats.hasPricing,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  return (
    <Card className={fullWidth ? "" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          各模型 Token 用量与费用
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={fullWidth ? "h-[400px]" : "h-[300px]"}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                opacity={0.5}
              />
              <XAxis
                xAxisId="tokens"
                type="number"
                tickFormatter={formatTokens}
                fontSize={11}
                stroke="var(--muted-foreground)"
                orientation="bottom"
              />
              <XAxis
                xAxisId="cost"
                type="number"
                tickFormatter={(v) => `$${v}`}
                fontSize={11}
                stroke="var(--muted-foreground)"
                orientation="top"
                hide
              />
              <YAxis
                type="category"
                dataKey="model"
                width={140}
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
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const item = payload[0]?.payload;
                  if (!item) return null;
                  return (
                    <div
                      style={{
                        backgroundColor: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        padding: "8px 12px",
                        fontSize: 12,
                        color: "var(--popover-foreground)",
                      }}
                    >
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>
                        {item.fullModel}
                      </p>
                      <p>总 Token: {formatTokens(item.tokens)}</p>
                      <p>输入: {formatTokens(item.input)}</p>
                      <p>输出: {formatTokens(item.output)}</p>
                      <p>费用: {formatCost(item.cost)}</p>
                      <p>轮次: {item.turns}</p>
                      <p>
                        定价: {item.hasPricing ? "✓ 已配置" : "✗ 未配置"}
                      </p>
                    </div>
                  );
                }}
              />
              <Legend
                verticalAlign="top"
                height={28}
                formatter={(value) =>
                  value === "tokens" ? "总 Token" : "费用 ($)"
                }
              />
              <Bar xAxisId="tokens" dataKey="tokens" radius={[0, 4, 4, 0]} name="tokens">
                {data.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Cost summary table below chart */}
        <div className="mt-4 border-t pt-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {data.map((item, i) => (
              <div key={item.fullModel} className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <div className="min-w-0">
                  <p className="font-mono text-xs truncate">{item.fullModel}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatCost(item.cost)}
                    {!item.hasPricing && (
                      <span className="text-yellow-500 ml-1">(未配置单价)</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
