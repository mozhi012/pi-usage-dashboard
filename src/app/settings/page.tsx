"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Plus,
  Trash2,
  FolderOpen,
  Check,
  X,
  Info,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";

interface SessionSource {
  id: number;
  path: string;
  label: string;
  enabled: boolean;
  createdAt: string;
}

export default function SettingsPage() {
  const [sources, setSources] = useState<SessionSource[]>([]);
  const [newPath, setNewPath] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [syncing, setSyncing] = useState(false);

  const homeDir = "~";

  const fetchSources = useCallback(async () => {
    const res = await fetch("/api/sources");
    const data = await res.json();
    setSources(data);
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchSources, 0);
    return () => clearTimeout(timer);
  }, [fetchSources]);

  const handleAdd = async () => {
    setError("");
    setSuccess("");

    if (!newPath.trim()) {
      setError("Path is required");
      return;
    }

    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: newPath.trim(),
        label: newLabel.trim() || newPath.trim(),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to add source");
      return;
    }

    setSuccess("Source added! Click Sync on the dashboard to refresh data.");
    setNewPath("");
    setNewLabel("");
    await fetchSources();
    setTimeout(() => setSuccess(""), 5000);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/usage");
      setSuccess("Synced! Dashboard data refreshed with all sources.");
      setTimeout(() => setSuccess(""), 3000);
    } catch {
      setError("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleToggle = async (source: SessionSource) => {
    await fetch("/api/sources", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, enabled: !source.enabled }),
    });
    await fetchSources();
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/sources?id=${id}`, { method: "DELETE" });
    await fetchSources();
  };

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
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  Session Sources
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Configure where to find pi session data
                </p>
              </div>
            </div>
            <Button
              onClick={handleSync}
              disabled={syncing}
              className="gap-1.5"
            >
              <RefreshCw
                className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
              />
              Sync Now
            </Button>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-6 py-6 space-y-6">
        {/* Info card */}
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex gap-3">
              <Info className="h-5 w-5 text-chart-2 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  The dashboard always reads from the default pi sessions
                  directory:{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                    ~/.pi/agent/sessions/
                  </code>
                </p>
                <p>
                  Add additional session source paths below to merge data from
                  other tools or harnesses that store pi-compatible JSONL
                  sessions (e.g., Superconductor, custom wrappers, team shared
                  directories).
                </p>
                <p>
                  Sessions are deduplicated by session ID — if the same session
                  appears in multiple sources, it&apos;s only counted once.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Add new source */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Session Source
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">
                  Path to sessions directory
                </Label>
                <Input
                  value={newPath}
                  onChange={(e) => {
                    setNewPath(e.target.value);
                    setError("");
                  }}
                  placeholder="e.g. ~/.superconductor/sessions/pi/"
                  className="mt-1 font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The directory will be recursively scanned for .jsonl session
                  files
                </p>
              </div>
              <div>
                <Label className="text-xs">Label (optional)</Label>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Superconductor, Work laptop, Team shared"
                  className="mt-1"
                />
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded-md bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-600 dark:text-green-400">
                  {success}
                </div>
              )}

              <Button onClick={handleAdd} className="gap-1.5">
                <FolderOpen className="h-4 w-4" />
                Add Source
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Configured sources */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              Configured Sources
              <Badge variant="secondary" className="ml-1">
                {sources.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sources.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No additional sources configured.</p>
                <p className="text-sm mt-1">
                  Only the default pi sessions directory is being scanned.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((source) => (
                    <TableRow key={source.id}>
                      <TableCell className="font-medium">
                        {source.label}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[400px] truncate">
                        {source.path}
                      </TableCell>
                      <TableCell className="text-center">
                        {source.enabled ? (
                          <Badge
                            variant="default"
                            className="bg-green-600 text-xs"
                          >
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Disabled
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggle(source)}
                            title={
                              source.enabled ? "Disable" : "Enable"
                            }
                          >
                            {source.enabled ? (
                              <X className="h-3.5 w-3.5" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(source.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Common paths examples */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Common Session Paths
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-md bg-muted/50 p-3">
                <div>
                  <p className="font-medium">Pi (default)</p>
                  <code className="text-xs font-mono text-muted-foreground">
                    ~/.pi/agent/sessions/
                  </code>
                </div>
                <Badge variant="outline" className="text-xs">
                  Always included
                </Badge>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/50 p-3">
                <div>
                  <p className="font-medium">Superconductor</p>
                  <code className="text-xs font-mono text-muted-foreground">
                    ~/.superconductor/sessions/pi/
                  </code>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setNewPath(homeDir + "/.superconductor/sessions/pi/");
                    setNewLabel("Superconductor");
                  }}
                >
                  Use
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/50 p-3">
                <div>
                  <p className="font-medium">Claude Code</p>
                  <code className="text-xs font-mono text-muted-foreground">
                    ~/.claude/sessions/
                  </code>
                </div>
                <Badge variant="secondary" className="text-xs">
                  If compatible
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
