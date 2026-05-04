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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
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
  Plus,
  Pencil,
  Trash2,
  Save,
  AlertTriangle,
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
  source?: "custom" | "builtin" | "cli";
}

interface ProviderInfo {
  name: string;
  baseUrl: string;
  api: string;
  hasAuth: boolean;
  authType: "api_key" | "oauth" | "none";
  modelCount: number;
  source?: "custom" | "builtin" | "cli";
  hasApiKey?: boolean;
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

interface ModelFormData {
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
  vision: boolean;
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
}

interface ProviderFormData {
  name: string;
  baseUrl: string;
  api: string;
  apiKey: string;
}

const DEFAULT_MODEL_FORM: ModelFormData = {
  id: "",
  name: "",
  contextWindow: "",
  maxTokens: "",
  reasoning: false,
  vision: false,
  costInput: "",
  costOutput: "",
  costCacheRead: "",
  costCacheWrite: "",
};

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
  const [error, setError] = useState<string | null>(null);

  // Provider dialog state
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderFormData>({
    name: "",
    baseUrl: "",
    api: "openai",
    apiKey: "",
  });
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);

  // Model dialog state
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelProvider, setModelProvider] = useState<string>("");
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState<ModelFormData>(DEFAULT_MODEL_FORM);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/models");
      if (!res.ok) {
        const errData = await res.json();
        setError(errData.error || "Failed to load models");
        return;
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(String(err));
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

  // --- Provider CRUD ---

  const openAddProvider = () => {
    setEditingProvider(null);
    setProviderForm({ name: "", baseUrl: "", api: "openai", apiKey: "" });
    setProviderError(null);
    setProviderDialogOpen(true);
  };

  const openEditProvider = (name: string, provider: ProviderInfo) => {
    setEditingProvider(name);
    setProviderForm({
      name,
      baseUrl: provider.baseUrl || "",
      api: provider.api || "openai",
      apiKey: "",
    });
    setProviderError(null);
    setProviderDialogOpen(true);
  };

  const handleSaveProvider = async () => {
    setProviderSaving(true);
    setProviderError(null);
    try {
      const isNew = !editingProvider;
      const method = isNew ? "POST" : "PUT";
      const action = isNew ? "add-provider" : "update-provider";

      const body: Record<string, any> = { action, name: providerForm.name, baseUrl: providerForm.baseUrl, api: providerForm.api };
      if (isNew) {
        body.apiKey = providerForm.apiKey;
      } else {
        // For updates, send apiKey only if it was changed
        if (providerForm.apiKey) body.apiKey = providerForm.apiKey;
        else body.apiKey = "";
      }

      const res = await fetch("/api/models", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const responseData = await res.json();
      if (!res.ok) {
        setProviderError(responseData.error || "Failed to save provider");
        return;
      }

      setProviderDialogOpen(false);
      await fetchData();
    } catch (err) {
      setProviderError(String(err));
    } finally {
      setProviderSaving(false);
    }
  };

  const handleDeleteProvider = async (name: string) => {
    if (!confirm(`Delete provider "${name}" and all its models? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/models?provider=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete provider");
        return;
      }
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  // --- Model CRUD ---

  const openAddModel = (provider: string) => {
    setModelProvider(provider);
    setEditingModelId(null);
    setModelForm(DEFAULT_MODEL_FORM);
    setModelError(null);
    setModelDialogOpen(true);
  };

  const openEditModel = (model: ModelInfo) => {
    setModelProvider(model.provider);
    setEditingModelId(model.id);
    setModelForm({
      id: model.id,
      name: model.name !== model.id ? model.name : "",
      contextWindow: model.contextWindow ? String(model.contextWindow) : "",
      maxTokens: model.maxTokens ? String(model.maxTokens) : "",
      reasoning: model.reasoning || false,
      vision: model.images || false,
      costInput: model.cost?.input ? String(model.cost.input) : "",
      costOutput: model.cost?.output ? String(model.cost.output) : "",
      costCacheRead: model.cost?.cacheRead ? String(model.cost.cacheRead) : "",
      costCacheWrite: model.cost?.cacheWrite ? String(model.cost.cacheWrite) : "",
    });
    setModelError(null);
    setModelDialogOpen(true);
  };

  const handleSaveModel = async () => {
    setModelSaving(true);
    setModelError(null);
    try {
      const isNew = !editingModelId;
      const method = isNew ? "POST" : "PUT";
      const action = isNew ? "add-model" : "update-model";

      if (isNew && !modelForm.id.trim()) {
        setModelError("Model ID is required");
        return;
      }

      const cost: Record<string, number> = {};
      if (modelForm.costInput) cost.input = parseFloat(modelForm.costInput);
      if (modelForm.costOutput) cost.output = parseFloat(modelForm.costOutput);
      if (modelForm.costCacheRead) cost.cacheRead = parseFloat(modelForm.costCacheRead);
      if (modelForm.costCacheWrite) cost.cacheWrite = parseFloat(modelForm.costCacheWrite);

      const inputTypes = ["text"];
      if (modelForm.vision) inputTypes.push("image");

      const body: Record<string, any> = { action };

      if (isNew) {
        body.provider = modelProvider;
        body.model = {
          id: modelForm.id.trim(),
          name: modelForm.name.trim() || modelForm.id.trim(),
          contextWindow: modelForm.contextWindow ? parseInt(modelForm.contextWindow, 10) : 0,
          maxTokens: modelForm.maxTokens ? parseInt(modelForm.maxTokens, 10) : 0,
          reasoning: modelForm.reasoning,
          input: inputTypes,
        };
        if (Object.keys(cost).length > 0) body.model.cost = cost;
      } else {
        body.provider = modelProvider;
        body.modelId = editingModelId;
        body.updates = {
          ...(modelForm.id.trim() !== editingModelId && { id: modelForm.id.trim() }),
          ...(modelForm.name.trim() && { name: modelForm.name.trim() }),
          ...(modelForm.contextWindow && { contextWindow: parseInt(modelForm.contextWindow, 10) }),
          ...(modelForm.maxTokens && { maxTokens: parseInt(modelForm.maxTokens, 10) }),
          reasoning: modelForm.reasoning,
          input: inputTypes,
        };
        if (Object.keys(cost).length > 0) body.updates.cost = cost;
      }

      const res = await fetch("/api/models", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const responseData = await res.json();
      if (!res.ok) {
        setModelError(responseData.error || "Failed to save model");
        return;
      }

      setModelDialogOpen(false);
      await fetchData();
    } catch (err) {
      setModelError(String(err));
    } finally {
      setModelSaving(false);
    }
  };

  const handleDeleteModel = async (provider: string, modelId: string) => {
    if (!confirm(`Delete model "${modelId}" from "${provider}"?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/models?provider=${encodeURIComponent(provider)}&modelId=${encodeURIComponent(modelId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete model");
        return;
      }
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
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
                  Models & Providers
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Manage custom providers and models (edit custom, built-in are read-only)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={openAddProvider} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add Provider
              </Button>
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
      </div>

      <main className="container mx-auto px-6 py-6 space-y-6">
        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

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
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Models</span>
                    <Cpu className="h-4 w-4 text-chart-1" />
                  </div>
                  <div className="text-2xl font-bold">{data.totalModels}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4 px-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Providers</span>
                    <Server className="h-4 w-4 text-chart-2" />
                  </div>
                  <div className="text-2xl font-bold">{data.totalProviders}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4 px-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Default</span>
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
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Auth Entries</span>
                    <Key className="h-4 w-4 text-chart-4" />
                  </div>
                  <div className="text-2xl font-bold">{data.authProviders.length}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">in auth.json</p>
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
                    <span className="text-sm font-normal text-muted-foreground">(~/.pi/agent/auth.json)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {data.authProviders.map((ap) => (
                      <Badge key={ap.id} variant="outline" className="text-xs gap-1.5 py-1.5 px-3">
                        {ap.type === "oauth" ? <Shield className="h-3 w-3 text-green-500" /> : <Key className="h-3 w-3 text-blue-500" />}
                        <span className="font-mono">{ap.id}</span>
                        <span className="text-muted-foreground">({ap.type})</span>
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
                {Object.entries(data.providers).map(([name, provider]) => {
                  const isCustom = provider.source === "custom";
                  const providerModels = data.models.filter((m) => m.provider === name);
                  return (
                    <Card key={name}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-base font-semibold flex items-center gap-2">
                              <Server className="h-4 w-4" />
                              {name}
                              {name === data.defaultProvider && (
                                <Badge className="text-xs bg-chart-5/20 text-chart-5 border-chart-5/30">Default</Badge>
                              )}
                              {isCustom && (
                                <Badge variant="outline" className="text-xs text-chart-2 border-chart-2/30">Custom</Badge>
                              )}
                            </CardTitle>
                          </div>
                          <div className="flex items-center gap-2">
                            {provider.hasAuth ? (
                              <Badge variant="outline" className="text-xs gap-1 text-green-600 border-green-600/30">
                                {provider.authType === "oauth" ? <Shield className="h-3 w-3" /> : <Key className="h-3 w-3" />}
                                {provider.authType === "oauth" ? "OAuth" : "API Key"}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs gap-1 text-red-500 border-red-500/30">
                                <ShieldOff className="h-3 w-3" />
                                No Auth
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-xs">
                              {provider.modelCount} models
                            </Badge>
                            {isCustom && (
                              <>
                                <Button variant="ghost" size="sm" onClick={() => openEditProvider(name, provider)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteProvider(name)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {provider.baseUrl && (
                          <div className="mb-4 grid grid-cols-[1fr_auto_auto_auto] gap-4 text-sm items-center">
                            <div>
                              <span className="text-xs text-muted-foreground">Base URL</span>
                              <p className="font-mono text-xs mt-0.5 truncate max-w-[400px]">{provider.baseUrl}</p>
                            </div>
                            <div>
                              <span className="text-xs text-muted-foreground">API Type</span>
                              <p className="font-mono text-xs mt-0.5">{provider.api}</p>
                            </div>
                          </div>
                        )}
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                            Models ({providerModels.length})
                          </span>
                          {isCustom && (
                            <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => openAddModel(name)}>
                              <Plus className="h-3 w-3" />
                              Add Model
                            </Button>
                          )}
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Model ID</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead className="text-right">Context</TableHead>
                              <TableHead className="text-right">Max Output</TableHead>
                              <TableHead className="text-right">Cost ($/1M)</TableHead>
                              <TableHead className="text-center">Features</TableHead>
                              {isCustom && <TableHead className="text-right w-20">Actions</TableHead>}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {providerModels.map((model) => (
                              <TableRow key={`${name}/${model.id}`}>
                                <TableCell className="font-mono text-sm">
                                  {model.id}
                                  {model.id === data.defaultModel && model.provider === data.defaultProvider && (
                                    <Star className="h-3 w-3 inline ml-1.5 text-chart-5" />
                                  )}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {model.name !== model.id ? model.name : "—"}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">{formatSize(model.contextWindow)}</TableCell>
                                <TableCell className="text-right font-mono text-sm">{formatSize(model.maxTokens)}</TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground">
                                  {model.cost && (model.cost.input > 0 || model.cost.output > 0)
                                    ? `${formatCost(model.cost.input)} / ${formatCost(model.cost.output)}`
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    {model.reasoning && (
                                      <Badge variant="outline" className="text-xs gap-0.5"><Brain className="h-3 w-3" /> Think</Badge>
                                    )}
                                    {model.images && (
                                      <Badge variant="outline" className="text-xs gap-0.5"><Image className="h-3 w-3" /> Vision</Badge>
                                    )}
                                    {!model.reasoning && !model.images && (
                                      <span className="text-xs text-muted-foreground">Text</span>
                                    )}
                                  </div>
                                </TableCell>
                                {isCustom && (
                                  <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                      <Button variant="ghost" size="sm" onClick={() => openEditModel(model)}>
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteModel(name, model.id)}
                                        className="text-destructive hover:text-destructive"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                )}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  );
                })}
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
                          <TableHead>Source</TableHead>
                          <TableHead>Provider</TableHead>
                          <TableHead>Model ID</TableHead>
                          <TableHead className="text-right">Context</TableHead>
                          <TableHead className="text-right">Max Output</TableHead>
                          <TableHead className="text-right">Cost In/Out ($/1M)</TableHead>
                          <TableHead className="text-center">Reasoning</TableHead>
                          <TableHead className="text-center">Vision</TableHead>
                          <TableHead className="text-right w-20">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredModels.map((model) => (
                          <TableRow key={`${model.provider}/${model.id}`}>
                            <TableCell>
                              {model.source === "custom" ? (
                                <Badge variant="outline" className="text-xs text-chart-2 border-chart-2/30">Custom</Badge>
                              ) : model.source === "builtin" ? (
                                <Badge variant="secondary" className="text-xs">Built-in</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs">CLI</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs font-mono">{model.provider}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm font-medium">
                              {model.id}
                              {model.id === data.defaultModel && model.provider === data.defaultProvider && (
                                <Star className="h-3 w-3 inline ml-1.5 text-chart-5" />
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">{formatSize(model.contextWindow)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{formatSize(model.maxTokens)}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {model.cost && (model.cost.input > 0 || model.cost.output > 0)
                                ? `${formatCost(model.cost.input)} / ${formatCost(model.cost.output)}`
                                : "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              {model.reasoning ? <Brain className="h-4 w-4 text-chart-2 mx-auto" /> : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-center">
                              {model.images ? <Image className="h-4 w-4 text-chart-4 mx-auto" /> : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              {model.source === "custom" ? (
                                <div className="flex justify-end gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => openEditModel(model)}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteModel(model.provider, model.id)}
                                    className="text-destructive hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
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

      {/* ─── Add/Edit Provider Dialog ─── */}
      <Dialog open={providerDialogOpen} onOpenChange={(open) => { if (!open) setProviderDialogOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProvider ? `Edit Provider: ${editingProvider}` : "Add Provider"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {!editingProvider && (
              <div>
                <Label className="text-xs">Provider Name</Label>
                <Input
                  value={providerForm.name}
                  onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                  placeholder="e.g. my-custom-provider"
                  className="mt-1 font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">Used as the key in models.json</p>
              </div>
            )}
            <div>
              <Label className="text-xs">Base URL</Label>
              <Input
                value={providerForm.baseUrl}
                onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })}
                placeholder="e.g. https://api.openai.com/v1"
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">API Type</Label>
              <Input
                value={providerForm.api}
                onChange={(e) => setProviderForm({ ...providerForm, api: e.target.value })}
                placeholder="e.g. openai, anthropic, custom"
                className="mt-1 font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Determines how pi calls the API (openai, anthropic, vertex, custom, etc.)
              </p>
            </div>
            <div>
              <Label className="text-xs">API Key {editingProvider ? "(leave blank to keep existing)" : "(optional)"}</Label>
              <Input
                type="password"
                value={providerForm.apiKey}
                onChange={(e) => setProviderForm({ ...providerForm, apiKey: e.target.value })}
                placeholder={editingProvider ? "••••••••" : "sk-..."}
                className="mt-1 font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">Stored in models.json, used by pi for authentication</p>
            </div>

            {providerError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">{providerError}</div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <DialogClose><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={handleSaveProvider} disabled={providerSaving || (!editingProvider && !providerForm.name)} className="gap-1.5">
                <Save className="h-4 w-4" />
                {providerSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Add/Edit Model Dialog ─── */}
      <Dialog open={modelDialogOpen} onOpenChange={(open) => { if (!open) setModelDialogOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingModelId ? `Edit Model: ${editingModelId}` : `Add Model to "${modelProvider}"`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2 max-h-[65vh] overflow-y-auto pr-1">
            <div>
              <Label className="text-xs">Model ID <span className="text-destructive">*</span></Label>
              <Input
                value={modelForm.id}
                onChange={(e) => setModelForm({ ...modelForm, id: e.target.value })}
                placeholder="e.g. gpt-4o-mini"
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Display Name (optional)</Label>
              <Input
                value={modelForm.name}
                onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })}
                placeholder="Defaults to Model ID"
                className="mt-1 font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Context Window</Label>
                <Input
                  type="number" min="0" step="1000"
                  value={modelForm.contextWindow}
                  onChange={(e) => setModelForm({ ...modelForm, contextWindow: e.target.value })}
                  placeholder="e.g. 128000"
                  className="mt-1 font-mono text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Max Tokens</Label>
                <Input
                  type="number" min="0" step="1000"
                  value={modelForm.maxTokens}
                  onChange={(e) => setModelForm({ ...modelForm, maxTokens: e.target.value })}
                  placeholder="e.g. 16384"
                  className="mt-1 font-mono text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={modelForm.reasoning}
                  onChange={(e) => setModelForm({ ...modelForm, reasoning: e.target.checked })}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-sm flex items-center gap-1">
                  <Brain className="h-3.5 w-3.5 text-chart-2" />
                  Reasoning
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={modelForm.vision}
                  onChange={(e) => setModelForm({ ...modelForm, vision: e.target.checked })}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-sm flex items-center gap-1">
                  <Image className="h-3.5 w-3.5 text-chart-4" />
                  Vision
                </span>
              </label>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Cost per 1M tokens</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Input ($)</Label>
                  <Input type="number" step="0.01" min="0"
                    value={modelForm.costInput}
                    onChange={(e) => setModelForm({ ...modelForm, costInput: e.target.value })}
                    placeholder="0.00"
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Output ($)</Label>
                  <Input type="number" step="0.01" min="0"
                    value={modelForm.costOutput}
                    onChange={(e) => setModelForm({ ...modelForm, costOutput: e.target.value })}
                    placeholder="0.00"
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Cache Read ($)</Label>
                  <Input type="number" step="0.01" min="0"
                    value={modelForm.costCacheRead}
                    onChange={(e) => setModelForm({ ...modelForm, costCacheRead: e.target.value })}
                    placeholder="0.00"
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Cache Write ($)</Label>
                  <Input type="number" step="0.01" min="0"
                    value={modelForm.costCacheWrite}
                    onChange={(e) => setModelForm({ ...modelForm, costCacheWrite: e.target.value })}
                    placeholder="0.00"
                    className="mt-1 font-mono text-sm"
                  />
                </div>
              </div>
            </div>

            {modelError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">{modelError}</div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <DialogClose><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={handleSaveModel} disabled={modelSaving || (!editingModelId && !modelForm.id.trim())} className="gap-1.5">
                <Save className="h-4 w-4" />
                {modelSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
