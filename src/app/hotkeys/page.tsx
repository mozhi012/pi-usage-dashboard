"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Keyboard, RefreshCw } from "lucide-react";
import Link from "next/link";

interface HotkeyEntry {
  id: string;
  defaults: string[];
  custom?: string[];
  description: string;
  category: string;
}

interface HotkeysData {
  hotkeys: HotkeyEntry[];
  hasCustomConfig: boolean;
  customConfigPath: string;
  categories: string[];
}

function KeyBadge({ keys }: { keys: string }) {
  return (
    <kbd className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-mono font-medium text-foreground shadow-sm">
      {keys}
    </kbd>
  );
}

export default function HotkeysPage() {
  const [data, setData] = useState<HotkeysData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hotkeys");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch hotkeys:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchData, 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

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
                  Hotkeys
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  All pi keyboard shortcuts
                </p>
              </div>
            </div>
            <Button
              onClick={fetchData}
              disabled={loading}
              variant="outline"
              className="gap-1.5"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-6 py-6 space-y-6">
        {!data ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span>Loading hotkeys...</span>
            </div>
          </div>
        ) : (
          <>
            {/* Info */}
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <Keyboard className="h-5 w-5 text-chart-2 flex-shrink-0" />
                  <div className="text-sm text-muted-foreground">
                    <p>
                      {data.hotkeys.length} keybindings across{" "}
                      {data.categories.length} categories.
                      {data.hasCustomConfig ? (
                        <span className="ml-1">
                          Custom config:{" "}
                          <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                            {data.customConfigPath}
                          </code>
                        </span>
                      ) : (
                        <span className="ml-1">
                          Customize at{" "}
                          <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                            ~/.pi/agent/keybindings.json
                          </code>
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Tabbed categories */}
            <Tabs defaultValue={data.categories[0]}>
              <TabsList className="flex-wrap h-auto gap-1 p-1">
                {data.categories.map((cat) => (
                  <TabsTrigger key={cat} value={cat} className="text-xs">
                    {cat}
                  </TabsTrigger>
                ))}
              </TabsList>

              {data.categories.map((cat) => (
                <TabsContent key={cat} value={cat} className="mt-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <Keyboard className="h-4 w-4" />
                        {cat}
                        <Badge variant="secondary" className="text-xs">
                          {data.hotkeys.filter((h) => h.category === cat).length}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1">
                        {data.hotkeys
                          .filter((h) => h.category === cat)
                          .map((hotkey) => (
                            <div
                              key={hotkey.id}
                              className="flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-muted/50 transition-colors"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">
                                  {hotkey.description}
                                </p>
                                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                  {hotkey.id}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                                {hotkey.custom ? (
                                  <>
                                    <div className="flex items-center gap-1.5">
                                      {hotkey.custom.map((k) => (
                                        <KeyBadge key={k} keys={k} />
                                      ))}
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className="text-xs text-chart-2 border-chart-2/30"
                                    >
                                      Custom
                                    </Badge>
                                  </>
                                ) : hotkey.defaults.length > 0 ? (
                                  <div className="flex items-center gap-1.5">
                                    {hotkey.defaults.map((k) => (
                                      <KeyBadge key={k} keys={k} />
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground italic">
                                    unbound
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              ))}
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
