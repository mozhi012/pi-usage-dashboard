"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface Props {
  byProject: Record<
    string,
    {
      tokens: number;
      cost: number;
      sessions: number;
      turns: number;
    }
  >;
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

export function ProjectsTable({ byProject }: Props) {
  const data = Object.entries(byProject)
    .map(([project, stats]) => ({ project, ...stats }))
    .sort((a, b) => b.tokens - a.tokens);

  const totalTokens = data.reduce((a, d) => a + d.tokens, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          各项目用量明细
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>项目</TableHead>
              <TableHead className="text-right">Token 用量</TableHead>
              <TableHead className="text-right">总用量占比</TableHead>
              <TableHead className="text-right">费用</TableHead>
              <TableHead className="text-right">会话数</TableHead>
              <TableHead className="text-right">轮次</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow
                key={row.project}
                className="cursor-pointer hover:bg-muted/50"
              >
                <TableCell className="font-mono text-sm">
                  <Link
                    href={`/project?path=${encodeURIComponent(row.project)}`}
                    className="hover:underline"
                  >
                    {row.project}
                  </Link>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatTokens(row.tokens)}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {totalTokens > 0
                      ? ((row.tokens / totalTokens) * 100).toFixed(1)
                      : 0}
                    %
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {formatCost(row.cost)}
                </TableCell>
                <TableCell className="text-right">{row.sessions}</TableCell>
                <TableCell className="text-right">{row.turns}</TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/project?path=${encodeURIComponent(row.project)}`}
                  >
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
