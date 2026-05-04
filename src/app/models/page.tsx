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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Cpu,
  Server,
  RefreshCw,
  Star,
  Shield,
  ShieldOff,
  Brain,
  Image,
  Key,
} from "lucide-react";
import Link from "next/link";

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  reasoning?: boolean;
  images?: boolean;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

interface ProviderInfo {
  name: string;
  baseUrl: string;
  api: string;
  hasAuth: boolean;
  authType: "api_key" | "oauth" | "none";
  modelCount: number;
}

interface AuthProvider {
  id: string;
  type: string;
}

interface ModelsData {
  models: ModelInfo[];
  providers: Record<string, ProviderInfo>;
  authProviders: AuthProvider[];
  defaultProvider: string;
  defaultModel: string;
  totalModels: number;
  totalProviders: number;
}

function formatSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export default function ModelsPage() {
  const [data, setData] = useState<ModelsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/models");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch models:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchData, 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

  const filteredModels = selectedProvider
    ? data?.models.filter((m) => m.provider === selectedProvider) || []
    : data?.models || [];

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
                  Models & Providers
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Authenticated models and provider configuration
                </p>
              </div>
            </div>
            <Button
              onClick={fetchData}
              disabled={loading}
              variant="outline"
              className="gap-1.5"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
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
              <span>Loading models...</span>
            </div>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-5 pb-4 px-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Total Models
                    </span>
                    <Cpu className="h-4 w-4 text-chart-1" />
                  </div>
                  <div className="text-2xl font-bold">{data.totalModels}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4 px-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Providers
                    </span>
                    <Server className="h-4 w-4 text-chart-2" />
                  </div>
                  <div className="text-2xl font-bold">{data.totalProviders}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4 px-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Default
                    </span>
                    <Star className="h-4 w-4 text-chart-5" />
                  </div>
                  <div className="text-sm font-bold font-mono truncate">
                    {data.defaultProvider}/{data.defaultModel || "—"}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4 px-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Auth Entries
                    </span>
                    <Key className="h-4 w-4 text-chart-4" />
                  </div>
                  <div className="text-2xl font-bold">
                    {data.authProviders.length}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    in auth.json
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Auth info */}
            {data.authProviders.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    Authentication
                    <span className="text-sm font-normal text-muted-foreground">
                      (~/.pi/agent/auth.json)
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {data.authProviders.map((ap) => (
                      <Badge
                        key={ap.id}
                        variant="outline"
                        className="text-xs gap-1.5 py-1.5 px-3"
                      >
                        {ap.type === "oauth" ? (
                          <Shield className="h-3 w-3 text-green-500" />
                        ) : (
                          <Key className="h-3 w-3 text-blue-500" />
                        )}
                        <span className="font-mono">{ap.id}</span>
                        <span className="text-muted-foreground">
                          ({ap.type})
                        </span>
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Tabs defaultValue="providers">
              <TabsList>
                <TabsTrigger value="providers" className="gap-1.5">
                  <Server className="h-3.5 w-3.5" />
                  Providers ({data.totalProviders})
                </TabsTrigger>
                <TabsTrigger value="models" className="gap-1.5">
                  <Cpu className="h-3.5 w-3.5" />
                  All Models ({data.totalModels})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="providers" className="mt-4 space-y-4">
                {Object.entries(data.providers).map(([name, provider]) => (
                  <Card key={name}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                          <Server className="h-4 w-4" />
                          {name}
                          {name === data.defaultProvider && (
                            <Badge className="text-xs bg-chart-5/20 text-chart-5 border-chart-5/30">
                              Default
                            </Badge>
                          )}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          {provider.hasAuth ? (
                            <Badge
                              variant="outline"
                              className="text-xs gap-1 text-green-600 border-green-600/30"
                            >
                              {provider.authType === "oauth" ? (
                                <Shield className="h-3 w-3" />
                              ) : (
                                <Key className="h-3 w-3" />
                              )}
                              {provider.authType === "oauth"
                                ? "OAuth"
                                : "API Key"}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-xs gap-1 text-red-500 border-red-500/30"
                            >
                              <ShieldOff className="h-3 w-3" />
                              No Auth
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-xs">
                            {provider.modelCount} models
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {provider.baseUrl && (
                        <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-xs text-muted-foreground">Base URL</span>
                            <p className="font-mono text-xs mt-0.5 truncate">{provider.baseUrl}</p>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">API Type</span>
                            <p className="font-mono text-xs mt-0.5">{provider.api}</p>
                          </div>
                        </div>
                      )}
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Model ID</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right">Context</TableHead>
                            <TableHead className="text-right">Max Output</TableHead>
                            <TableHead className="text-right">Cost ($/1M)</TableHead>
                            <TableHead className="text-center">Features</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.models
                            .filter((m) => m.provider === name)
                            .map((model) => (
                              <TableRow key={`${name}/${model.id}`}>
                                <TableCell className="font-mono text-sm">
                                  {model.id}
                                  {model.id === data.defaultModel &&
                                    model.provider === data.defaultProvider && (
                                      <Star className="h-3 w-3 inline ml-1.5 text-chart-5" />
                                    )}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {model.name !== model.id ? model.name : "—"}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {formatSize(model.contextWindow)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {formatSize(model.maxTokens)}
                                </TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground">
                                  {model.cost && (model.cost.input > 0 || model.cost.output > 0)
                                    ? `${formatCost(model.cost.input)} / ${formatCost(model.cost.output)}`
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    {model.reasoning && (
                                      <Badge variant="outline" className="text-xs gap-0.5">
                                        <Brain className="h-3 w-3" /> Think
                                      </Badge>
                                    )}
                                    {model.images && (
                                      <Badge variant="outline" className="text-xs gap-0.5">
                                        <Image className="h-3 w-3" /> Vision
                                      </Badge>
                                    )}
                                    {!model.reasoning && !model.images && (
                                      <span className="text-xs text-muted-foreground">Text</span>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              <TabsContent value="models" className="mt-4">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold">All Models</CardTitle>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          variant={selectedProvider === null ? "default" : "outline"}
                          size="sm"
                          className="text-xs"
                          onClick={() => setSelectedProvider(null)}
                        >
                          All ({data.totalModels})
                        </Button>
                        {Object.entries(data.providers).map(([p, info]) => (
                          <Button
                            key={p}
                            variant={selectedProvider === p ? "default" : "outline"}
                            size="sm"
                            className="text-xs"
                            onClick={() => setSelectedProvider(p)}
                          >
                            {p} ({info.modelCount})
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Provider</TableHead>
                          <TableHead>Model ID</TableHead>
                          <TableHead className="text-right">Context</TableHead>
                          <TableHead className="text-right">Max Output</TableHead>
                          <TableHead className="text-right">Cost In/Out ($/1M)</TableHead>
                          <TableHead className="text-center">Reasoning</TableHead>
                          <TableHead className="text-center">Vision</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredModels.map((model) => (
                          <TableRow key={`${model.provider}/${model.id}`}>
                            <TableCell>
                              <Badge variant="outline" className="text-xs font-mono">
                                {model.provider}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm font-medium">
                              {model.id}
                              {model.id === data.defaultModel &&
                                model.provider === data.defaultProvider && (
                                  <Star className="h-3 w-3 inline ml-1.5 text-chart-5" />
                                )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatSize(model.contextWindow)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatSize(model.maxTokens)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {model.cost && (model.cost.input > 0 || model.cost.output > 0)
                                ? `${formatCost(model.cost.input)} / ${formatCost(model.cost.output)}`
                                : "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              {model.reasoning ? (
                                <Brain className="h-4 w-4 text-chart-2 mx-auto" />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {model.images ? (
                                <Image className="h-4 w-4 text-chart-4 mx-auto" />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
