"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Terminal,
  Zap,
  DollarSign,
  MessageSquare,
  Clock,
} from "lucide-react";
import Link from "next/link";
import type { AggregatedData, SessionData } from "@/lib/parse-sessions";

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

function formatDate(timestamp: string | number): string {
  try {
    const date =
      typeof timestamp === "number" ? new Date(timestamp) : new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(timestamp);
  }
}

function timeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(timestamp);
}

export default function ProjectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>}>
      <ProjectContent />
    </Suspense>
  );
}

function ProjectContent() {
  const searchParams = useSearchParams();
  const project = searchParams.get("path") || "";
  const [data, setData] = useState<AggregatedData | null>(null);
  const [sessions, setSessions] = useState<SessionData[]>([]);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/usage");
    const json: AggregatedData = await res.json();
    setData(json);

    // Filter sessions for this project
    const projectSessions = json.sessions.filter((s) => s.project === project);
    setSessions(projectSessions);
  }, [project]);

  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(fetchData, 0);
    return () => clearTimeout(timer);
  }, [project, fetchData]);

  const projectStats = data?.byProject[project];

  const handleOpenTerminal = async (
    action?: "resume" | "fork",
    sessionId?: string,
    sessionFile?: string
  ) => {
    await fetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cwd: project,
        sessionId,
        sessionFile,
        action,
      }),
    });
  };

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">No project specified</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <ArrowLeft className="h-4 w-4" />
                  Dashboard
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground font-mono">
                  {project}
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {sessions.length} sessions
                </p>
              </div>
            </div>
            <Button
              onClick={() => handleOpenTerminal()}
              className="gap-1.5"
            >
              <Terminal className="h-4 w-4" />
              New Pi Session
            </Button>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-6 py-6 space-y-6">
        {/* Project stats */}
        {projectStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Total Tokens
                  </span>
                  <Zap className="h-4 w-4 text-chart-1" />
                </div>
                <div className="text-2xl font-bold">
                  {formatTokens(projectStats.tokens)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Total Cost
                  </span>
                  <DollarSign className="h-4 w-4 text-chart-5" />
                </div>
                <div className="text-2xl font-bold">
                  {formatCost(projectStats.cost)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Sessions
                  </span>
                  <MessageSquare className="h-4 w-4 text-chart-2" />
                </div>
                <div className="text-2xl font-bold">
                  {projectStats.sessions}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Turns
                  </span>
                  <Clock className="h-4 w-4 text-chart-4" />
                </div>
                <div className="text-2xl font-bold">
                  {projectStats.turns}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Sessions list */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Last Active</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Models</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Turns</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.sessionId}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">
                          {timeAgo(session.lastInteraction)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(session.lastInteraction)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(session.timestamp)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {session.modelsUsed.slice(0, 2).map((model) => (
                          <Badge
                            key={model}
                            variant="outline"
                            className="text-xs font-mono"
                          >
                            {model.length > 16 ? model.slice(0, 14) + "…" : model}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatTokens(session.totalUsage.totalTokens)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCost(session.totalUsage.cost.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      {session.assistantTurns}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() =>
                            handleOpenTerminal("resume", session.sessionId, session.sessionFile)
                          }
                        >
                          Resume
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() =>
                            handleOpenTerminal("fork", session.sessionId, session.sessionFile)
                          }
                        >
                          Fork
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
