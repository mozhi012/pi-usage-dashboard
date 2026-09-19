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
  Eye,
  EyeOff,
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
  inScope: boolean;
  /** Whether pi can actually use this model right now (per pi --list-models). */
  available: boolean;
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
  scope: { active: boolean; patterns: string[]; fallback?: boolean; readError?: string };
  catalogOk: boolean;
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

  // Model scope (enabledModels) state — a single busy flag so concurrent
  // toggle/reset/refresh actions can never interleave.
  const [scopeBusy, setScopeBusy] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/models");
      if (!res.ok) {
        const errData = await res.json();
        setError(errData.error || "加载模型失败");
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
        setProviderError(responseData.error || "保存提供商失败");
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
    if (!confirm(`确认删除提供商 "${name}" 及其所有模型吗？此操作无法撤销。`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/models?provider=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "删除提供商失败");
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
        setModelError("模型 ID 不能为空");
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
        setModelError(responseData.error || "保存模型失败");
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
    if (!confirm(`确认从 "${provider}" 中删除模型 "${modelId}" 吗？`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/models?provider=${encodeURIComponent(provider)}&modelId=${encodeURIComponent(modelId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "删除模型失败");
        return;
      }
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  // --- Model scope (Pi enabledModels) ---

  const scopeSettingsBroken = !!data?.scope?.readError;
  const scopeCatalogOk = data?.catalogOk ?? true;
  // Toggles need both a readable settings.json and a successful CLI catalog;
  // reset only needs readable settings (it does not depend on the CLI).
  const scopeToggleDisabled = scopeBusy || scopeSettingsBroken || !scopeCatalogOk;

  /** Apply a refreshed payload returned by scope mutations, or refetch. */
  const applyScopeResult = async (responseData: ModelsData | null) => {
    if (responseData && Array.isArray(responseData.models)) {
      setData(responseData);
    } else {
      await fetchData();
    }
  };

  const handleToggleScope = async (model: ModelInfo) => {
    if (scopeBusy || !data || scopeSettingsBroken || !scopeCatalogOk || !model.available) return;

    if (model.inScope) {
      const isDefault = model.id === data.defaultModel && model.provider === data.defaultProvider;
      let msg = `将模型 "${model.provider}/${model.id}" 排除出 Pi 的模型选择范围？\n\n`;
      msg += "排除后，Pi 的 /model 默认列表与 Ctrl+P 轮换将不再包含该模型；";
      msg += "切换到“全部模型”时仍可见，且模型配置不会被删除。";
      msg += data.scope?.active
        ? "\n\n当前已启用范围限制：若该模型被通配规则覆盖，相关规则会展开为其余模型的明确列表。"
        : "\n\n当前尚未启用范围限制：本次操作会写入一份明确的模型列表。";
      msg += "展开通配规则后，未来 Pi 新增的模型可能需要手动纳入。";
      if (isDefault) msg += "\n\n该模型是当前启动默认模型，排除后启动默认不变。";
      msg += "\n\n重启 Pi 进程后生效；项目级 enabledModels/--models 会覆盖全局设置。";
      if (!confirm(msg)) return;
    }

    setError(null);
    setScopeBusy(true);
    try {
      const res = await fetch("/api/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-model-scope",
          provider: model.provider,
          modelId: model.id,
          inScope: !model.inScope,
        }),
      });
      const responseData = await res.json();
      if (!res.ok) {
        setError(responseData.error || "更新模型范围失败");
        return;
      }
      await applyScopeResult(responseData);
    } catch (err) {
      setError(String(err));
    } finally {
      setScopeBusy(false);
    }
  };

  const handleResetScope = async () => {
    if (scopeBusy || scopeSettingsBroken) return;
    if (!confirm("移除所有模型范围限制（settings.json 的 enabledModels）？\nPi 默认模型列表将恢复显示所有模型，重启 Pi 进程后生效。")) return;
    setError(null);
    setScopeBusy(true);
    try {
      const res = await fetch("/api/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-model-scope" }),
      });
      const responseData = await res.json();
      if (!res.ok) {
        setError(responseData.error || "移除范围限制失败");
        return;
      }
      await applyScopeResult(responseData);
    } catch (err) {
      setError(String(err));
    } finally {
      setScopeBusy(false);
    }
  };

  /** Eye / EyeOff toggle for the selection scope, shared by both tables. */
  const renderScopeToggle = (model: ModelInfo) => {
    const unavailable = !model.available;
    const title = unavailable
      ? `模型当前不可用（无凭据或未在 pi 目录中），完成认证后才可设置范围：${model.provider}/${model.id}`
      : model.inScope
        ? `排除出模型选择范围：${model.provider}/${model.id}`
        : `纳入模型选择范围：${model.provider}/${model.id}`;
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={scopeToggleDisabled || unavailable}
        aria-label={title}
        title={title}
        onClick={() => handleToggleScope(model)}
        className={model.inScope ? "" : "text-chart-5"}
      >
        {model.inScope ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </Button>
    );
  };

  const renderExcludedBadge = (model: ModelInfo) =>
    !model.inScope ? (
      <Badge variant="secondary" className="ml-1.5 text-xs">已排除</Badge>
    ) : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <ArrowLeft className="h-4 w-4" />
                  返回主面板
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  模型与提供商
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  管理自定义提供商与模型（支持编辑自定义项，内置模型为只读；眼睛图标可纳入/排除 Pi 模型选择范围）
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={openAddProvider} className="gap-1.5">
                <Plus className="h-4 w-4" />
                添加提供商
              </Button>
              <Button
                onClick={fetchData}
                disabled={loading || scopeBusy}
                variant="outline"
                className="gap-1.5"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                刷新
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
              <span>正在加载模型...</span>
            </div>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-5 pb-4 px-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">模型总数</span>
                    <Cpu className="h-4 w-4 text-chart-1" />
                  </div>
                  <div className="text-2xl font-bold">{data.totalModels}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4 px-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">提供商</span>
                    <Server className="h-4 w-4 text-chart-2" />
                  </div>
                  <div className="text-2xl font-bold">{data.totalProviders}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4 px-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">默认模型</span>
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
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">认证凭据</span>
                    <Key className="h-4 w-4 text-chart-4" />
                  </div>
                  <div className="text-2xl font-bold">{data.authProviders.length}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">保存在 auth.json</p>
                </CardContent>
              </Card>
            </div>

            {/* Auth info */}
            {data.authProviders.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    认证凭据配置
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

            {/* Model selection scope (enabledModels) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  模型选择范围
                  <span className="text-sm font-normal text-muted-foreground">(~/.pi/agent/settings.json 的 enabledModels)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  范围只影响 Pi 会话中 <span className="font-mono">/model</span> 的默认列表与 Ctrl+P 轮换；
                  这是选择范围而非彻底禁用，被排除的模型在“全部模型”列表中仍可见。重启 Pi 进程后生效；
                  项目级 <span className="font-mono">enabledModels</span>/<span className="font-mono">--models</span> 会覆盖全局设置。
                </p>
                {data.scope?.readError && (
                  <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                    {data.scope.readError}
                  </div>
                )}
                {!data.catalogOk && (
                  <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-3 text-sm text-yellow-600">
                    pi --list-models 目录获取失败：当前范围状态仅为只读预览，可能不准确；
                    为避免用不完整目录覆盖范围，暂时不能修改选择范围。
                  </div>
                )}
                {data.scope?.fallback && (
                  <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-3 text-sm text-yellow-600">
                    enabledModels 存在配置但没有匹配到任何可用模型，Pi 会回退为显示全部模型。
                  </div>
                )}
                {data.scope?.active ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {data.scope.patterns.map((p) => (
                        <Badge key={p} variant="outline" className="text-xs font-mono gap-1.5 py-1 px-2.5">
                          {p}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        disabled={scopeBusy || scopeSettingsBroken}
                        onClick={handleResetScope}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        恢复不限范围
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        当前模型范围内的模型共 {data.models.filter((m) => m.inScope).length}/{data.totalModels} 个
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    未启用范围限制，Pi 默认模型列表显示所有模型。排除任意模型后会写入明确列表。
                  </p>
                )}
              </CardContent>
            </Card>

            <Tabs defaultValue="providers">
              <TabsList>
                <TabsTrigger value="providers" className="gap-1.5">
                  <Server className="h-3.5 w-3.5" />
                  按提供商 ({data.totalProviders})
                </TabsTrigger>
                <TabsTrigger value="models" className="gap-1.5">
                  <Cpu className="h-3.5 w-3.5" />
                  全部模型 ({data.totalModels})
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
                                <Badge className="text-xs bg-chart-5/20 text-chart-5 border-chart-5/30">默认</Badge>
                              )}
                              {isCustom && (
                                <Badge variant="outline" className="text-xs text-chart-2 border-chart-2/30">自定义</Badge>
                              )}
                            </CardTitle>
                          </div>
                          <div className="flex items-center gap-2">
                            {provider.hasAuth ? (
                              <Badge variant="outline" className="text-xs gap-1 text-green-600 border-green-600/30">
                                {provider.authType === "oauth" ? <Shield className="h-3 w-3" /> : <Key className="h-3 w-3" />}
                                {provider.authType === "oauth" ? "OAuth" : "API 密钥"}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs gap-1 text-red-500 border-red-500/30">
                                <ShieldOff className="h-3 w-3" />
                                无凭据
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-xs">
                              {provider.modelCount} 个模型
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
                              <span className="text-xs text-muted-foreground">接口地址 (Base URL)</span>
                              <p className="font-mono text-xs mt-0.5 truncate max-w-[400px]">{provider.baseUrl}</p>
                            </div>
                            <div>
                              <span className="text-xs text-muted-foreground">接口类型 (API Type)</span>
                              <p className="font-mono text-xs mt-0.5">{provider.api}</p>
                            </div>
                          </div>
                        )}
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                            模型列表 ({providerModels.length})
                          </span>
                          {isCustom && (
                            <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => openAddModel(name)}>
                              <Plus className="h-3 w-3" />
                              添加模型
                            </Button>
                          )}
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>模型 ID</TableHead>
                              <TableHead>名称</TableHead>
                              <TableHead className="text-right">上下文窗口</TableHead>
                              <TableHead className="text-right">最大输出</TableHead>
                              <TableHead className="text-right">单价 ($/1M)</TableHead>
                              <TableHead className="text-center">特性</TableHead>
                              <TableHead className="text-right w-24">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {providerModels.map((model) => (
                              <TableRow key={`${name}/${model.id}`} className={model.inScope ? "" : "opacity-60"}>
                                <TableCell className="font-mono text-sm">
                                  {model.id}
                                  {model.id === data.defaultModel && model.provider === data.defaultProvider && (
                                    <Star className="h-3 w-3 inline ml-1.5 text-chart-5" />
                                  )}
                                  {renderExcludedBadge(model)}
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
                                      <Badge variant="outline" className="text-xs gap-0.5"><Brain className="h-3 w-3" /> 思考</Badge>
                                    )}
                                    {model.images && (
                                      <Badge variant="outline" className="text-xs gap-0.5"><Image className="h-3 w-3" /> 视觉</Badge>
                                    )}
                                    {!model.reasoning && !model.images && (
                                      <span className="text-xs text-muted-foreground">文本</span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1">
                                    {renderScopeToggle(model)}
                                    {model.source === "custom" && (
                                      <>
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
                                      </>
                                    )}
                                  </div>
                                </TableCell>
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
                      <CardTitle className="text-base font-semibold">全部模型</CardTitle>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          variant={selectedProvider === null ? "default" : "outline"}
                          size="sm"
                          className="text-xs"
                          onClick={() => setSelectedProvider(null)}
                        >
                          全部 ({data.totalModels})
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
                          <TableHead>来源</TableHead>
                          <TableHead>提供商</TableHead>
                          <TableHead>模型 ID</TableHead>
                          <TableHead className="text-right">上下文窗口</TableHead>
                          <TableHead className="text-right">最大输出</TableHead>
                          <TableHead className="text-right">单价 输入/输出 ($/1M)</TableHead>
                          <TableHead className="text-center">深度思考</TableHead>
                          <TableHead className="text-center">视觉能力</TableHead>
                          <TableHead className="text-right w-20">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredModels.map((model) => (
                          <TableRow key={`${model.provider}/${model.id}`} className={model.inScope ? "" : "opacity-60"}>
                            <TableCell>
                              {model.source === "custom" ? (
                                <Badge variant="outline" className="text-xs text-chart-2 border-chart-2/30">自定义</Badge>
                              ) : model.source === "builtin" ? (
                                <Badge variant="secondary" className="text-xs">内置</Badge>
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
                              {renderExcludedBadge(model)}
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
                              <div className="flex justify-end gap-1">
                                {renderScopeToggle(model)}
                                {model.source === "custom" && (
                                  <>
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
                                  </>
                                )}
                              </div>
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
            <DialogTitle>{editingProvider ? `编辑提供商: ${editingProvider}` : "添加提供商"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {!editingProvider && (
              <div>
                <Label className="text-xs">提供商名称</Label>
                <Input
                  value={providerForm.name}
                  onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                  placeholder="例如: my-custom-provider"
                  className="mt-1 font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">作为 models.json 中的唯一键名</p>
              </div>
            )}
            <div>
              <Label className="text-xs">基础接口地址 (Base URL)</Label>
              <Input
                value={providerForm.baseUrl}
                onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })}
                placeholder="例如: https://api.openai.com/v1"
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">接口类型 (API Type)</Label>
              <Input
                value={providerForm.api}
                onChange={(e) => setProviderForm({ ...providerForm, api: e.target.value })}
                placeholder="例如: openai, anthropic, custom"
                className="mt-1 font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                决定 Pi 如何发起请求协议 (openai, anthropic, vertex, custom 等)
              </p>
            </div>
            <div>
              <Label className="text-xs">API 密钥 {editingProvider ? "(留空则保持现有密钥)" : "(可选)"}</Label>
              <Input
                type="password"
                value={providerForm.apiKey}
                onChange={(e) => setProviderForm({ ...providerForm, apiKey: e.target.value })}
                placeholder={editingProvider ? "••••••••" : "sk-..."}
                className="mt-1 font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">保存于 models.json，用于 Pi 鉴权访问</p>
            </div>

            {providerError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">{providerError}</div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <DialogClose><Button variant="outline">取消</Button></DialogClose>
              <Button onClick={handleSaveProvider} disabled={providerSaving || (!editingProvider && !providerForm.name)} className="gap-1.5">
                <Save className="h-4 w-4" />
                {providerSaving ? "正在保存..." : "保存"}
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
              {editingModelId ? `编辑模型: ${editingModelId}` : `为 "${modelProvider}" 添加模型`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2 max-h-[65vh] overflow-y-auto pr-1">
            <div>
              <Label className="text-xs">模型 ID <span className="text-destructive">*</span></Label>
              <Input
                value={modelForm.id}
                onChange={(e) => setModelForm({ ...modelForm, id: e.target.value })}
                placeholder="例如: gpt-4o-mini"
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">显示名称 (可选)</Label>
              <Input
                value={modelForm.name}
                onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })}
                placeholder="默认为模型 ID"
                className="mt-1 font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">上下文窗口 (Tokens)</Label>
                <Input
                  type="number" min="0" step="1000"
                  value={modelForm.contextWindow}
                  onChange={(e) => setModelForm({ ...modelForm, contextWindow: e.target.value })}
                  placeholder="例如: 128000"
                  className="mt-1 font-mono text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">最大输出 (Tokens)</Label>
                <Input
                  type="number" min="0" step="1000"
                  value={modelForm.maxTokens}
                  onChange={(e) => setModelForm({ ...modelForm, maxTokens: e.target.value })}
                  placeholder="例如: 16384"
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
                  深度思考 (Reasoning)
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
                  视觉识别 (Vision)
                </span>
              </label>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">每 100 万 Token 单价 (美元)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">提示词输入 ($)</Label>
                  <Input type="number" step="0.01" min="0"
                    value={modelForm.costInput}
                    onChange={(e) => setModelForm({ ...modelForm, costInput: e.target.value })}
                    placeholder="0.00"
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">模型输出 ($)</Label>
                  <Input type="number" step="0.01" min="0"
                    value={modelForm.costOutput}
                    onChange={(e) => setModelForm({ ...modelForm, costOutput: e.target.value })}
                    placeholder="0.00"
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">缓存读取 ($)</Label>
                  <Input type="number" step="0.01" min="0"
                    value={modelForm.costCacheRead}
                    onChange={(e) => setModelForm({ ...modelForm, costCacheRead: e.target.value })}
                    placeholder="0.00"
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">缓存写入 ($)</Label>
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
              <DialogClose><Button variant="outline">取消</Button></DialogClose>
              <Button onClick={handleSaveModel} disabled={modelSaving || (!editingModelId && !modelForm.id.trim())} className="gap-1.5">
                <Save className="h-4 w-4" />
                {modelSaving ? "正在保存..." : "保存"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
