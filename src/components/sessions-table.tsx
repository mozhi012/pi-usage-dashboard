"use client";

import { useState } from "react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Terminal,
  GitFork,
  Play,
  Zap,
  DollarSign,
  Download,
  Share2,
  Copy,
} from "lucide-react";
import type { SessionData } from "@/lib/parse-sessions";

interface Props {
  sessions: SessionData[];
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

function formatDate(timestamp: string | number): string {
  try {
    const date =
      typeof timestamp === "number"
        ? new Date(timestamp)
        : new Date(timestamp);
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

export function SessionsTable({ sessions }: Props) {
  const [selectedSession, setSelectedSession] = useState<SessionData | null>(
    null
  );
  const [launching, setLaunching] = useState(false);
  const [actionResult, setActionResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const handleAction = async (action: "resume" | "fork") => {
    if (!selectedSession) return;
    setLaunching(true);

    const cwd = selectedSession.project.startsWith("~")
      ? selectedSession.project
      : selectedSession.project;

    try {
      await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          sessionId: selectedSession.sessionId,
          sessionFile: selectedSession.sessionFile,
          action,
        }),
      });
    } finally {
      setLaunching(false);
      setSelectedSession(null);
    }
  };

  const handleSessionAction = async (
    action: "export" | "share" | "duplicate"
  ) => {
    if (!selectedSession) return;
    setLaunching(true);
    setActionResult(null);

    try {
      const res = await fetch("/api/session-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          sessionFile: selectedSession.sessionFile,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setActionResult({ type: "error", message: data.error || "Failed" });
      } else {
        setActionResult({
          type: "success",
          message: data.message || "Done!",
        });
      }
    } catch (err) {
      setActionResult({ type: "error", message: String(err) });
    } finally {
      setLaunching(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            All Sessions
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({sessions.length} total, sorted by last activity)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Last Active</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Models</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">User</TableHead>
                  <TableHead className="text-right">Assistant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow
                    key={session.sessionId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedSession(session)}
                  >
                    <TableCell className="text-sm whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {timeAgo(session.lastInteraction)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(session.lastInteraction)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(session.timestamp)}
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate">
                      {session.project}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {session.modelsUsed.slice(0, 2).map((model) => (
                          <Badge
                            key={model}
                            variant="outline"
                            className="text-xs font-mono"
                          >
                            {model.length > 18
                              ? model.slice(0, 16) + "…"
                              : model}
                          </Badge>
                        ))}
                        {session.modelsUsed.length > 2 && (
                          <Badge variant="secondary" className="text-xs">
                            +{session.modelsUsed.length - 2}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatTokens(session.totalUsage.totalTokens)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCost(session.totalUsage.cost.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      {session.userTurns}
                    </TableCell>
                    <TableCell className="text-right">
                      {session.assistantTurns}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Session action dialog */}
      <Dialog
        open={!!selectedSession}
        onOpenChange={(open) => {
          if (!open) setSelectedSession(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Session Actions</DialogTitle>
          </DialogHeader>
          {selectedSession && (
            <div className="space-y-4 pt-2">
              {/* Session info */}
              <div className="rounded-md bg-muted/50 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Project</span>
                  <span className="font-mono text-xs">
                    {selectedSession.project}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Last Active
                  </span>
                  <span className="text-sm font-medium">
                    {timeAgo(selectedSession.lastInteraction)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Session ID
                  </span>
                  <span className="font-mono text-xs">
                    {selectedSession.sessionId.slice(0, 12)}…
                  </span>
                </div>
                <div className="flex items-center gap-4 pt-1">
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-chart-1" />
                    <span className="text-sm">
                      {formatTokens(selectedSession.totalUsage.totalTokens)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-chart-5" />
                    <span className="text-sm">
                      {formatCost(selectedSession.totalUsage.cost.total)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {selectedSession.userTurns} user /{" "}
                    {selectedSession.assistantTurns} assistant turns
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {selectedSession.modelsUsed.map((model) => (
                    <Badge
                      key={model}
                      variant="outline"
                      className="text-xs font-mono"
                    >
                      {model}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => handleAction("resume")}
                  disabled={launching}
                  className="gap-2 h-auto py-4 flex-col"
                >
                  <Play className="h-5 w-5" />
                  <div className="text-center">
                    <p className="font-medium">Resume</p>
                    <p className="text-xs opacity-80">
                      Continue this session
                    </p>
                  </div>
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleAction("fork")}
                  disabled={launching}
                  className="gap-2 h-auto py-4 flex-col"
                >
                  <GitFork className="h-5 w-5" />
                  <div className="text-center">
                    <p className="font-medium">Fork</p>
                    <p className="text-xs opacity-80">
                      Branch into new session
                    </p>
                  </div>
                </Button>
              </div>

              {/* Export / Share / Duplicate */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5 text-xs"
                  onClick={() => handleSessionAction("export")}
                  disabled={launching}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export HTML
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5 text-xs"
                  onClick={() => handleSessionAction("share")}
                  disabled={launching}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share (Gist)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5 text-xs"
                  onClick={() => handleSessionAction("duplicate")}
                  disabled={launching}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Duplicate
                </Button>
              </div>

              {actionResult && (
                <div
                  className={`rounded-md p-3 text-xs ${
                    actionResult.type === "success"
                      ? "bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400"
                      : "bg-destructive/10 border border-destructive/20 text-destructive"
                  }`}
                >
                  {actionResult.message}
                </div>
              )}

              <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
                <Terminal className="h-3.5 w-3.5" />
                Resume/Fork opens a new terminal window with pi
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
