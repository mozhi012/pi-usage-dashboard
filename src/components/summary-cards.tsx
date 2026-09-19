"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  MessageSquare,
  Zap,
  ArrowUpRight,
  ArrowDownLeft,
  Database,
  DollarSign,
  Cpu,
  Users,
} from "lucide-react";

type TimeRange = "daily" | "weekly" | "monthly";

interface SummaryProps {
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
  timeRange?: TimeRange;
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

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  daily: "全部日期",
  weekly: "全部周",
  monthly: "全部月份",
};

export function SummaryCards({ summary, timeRange = "daily" }: SummaryProps) {
  const cards = [
    {
      label: "总 Token 数",
      value: formatTokens(summary.totalTokens),
      icon: Zap,
      description: "跨所有会话累计",
      accent: "text-chart-1",
    },
    {
      label: "输入 Token",
      value: formatTokens(summary.totalInputTokens),
      icon: ArrowUpRight,
      description: "发送至模型的提示词",
      accent: "text-chart-2",
    },
    {
      label: "输出 Token",
      value: formatTokens(summary.totalOutputTokens),
      icon: ArrowDownLeft,
      description: "模型生成的回复",
      accent: "text-chart-3",
    },
    {
      label: "缓存读取",
      value: formatTokens(summary.totalCacheRead),
      icon: Database,
      description: "命中缓存的 Token",
      accent: "text-chart-4",
    },
    {
      label: "预估总费用",
      value: formatCost(summary.totalCost),
      icon: DollarSign,
      description: "API 消耗费用",
      accent: "text-chart-5",
    },
    {
      label: "会话数",
      value: summary.totalSessions.toString(),
      icon: MessageSquare,
      description: `${summary.totalUserTurns} 用户轮次 / ${summary.totalAssistantTurns} 助手轮次`,
      accent: "text-chart-1",
    },
    {
      label: "已用模型",
      value: summary.modelsUsed.toString(),
      icon: Cpu,
      description: "调用的不同模型数",
      accent: "text-chart-2",
    },
    {
      label: "提供商",
      value: summary.providersUsed.toString(),
      icon: Users,
      description: "API 服务提供商",
      accent: "text-chart-4",
    },
  ];

  return (
    <div className="space-y-2">
      {timeRange && (
        <p className="text-xs text-muted-foreground">
          当前统计范围：<span className="font-medium text-foreground">{TIME_RANGE_LABELS[timeRange]}</span>
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {card.label}
              </span>
              <card.icon className={`h-4 w-4 ${card.accent}`} />
            </div>
            <div className="text-2xl font-bold tracking-tight">{card.value}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {card.description}
            </p>
          </CardContent>
        </Card>
      ))}
      </div>
    </div>
  );
}
