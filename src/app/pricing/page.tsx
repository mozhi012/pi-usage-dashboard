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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Plus,
  DollarSign,
  Save,
} from "lucide-react";
import Link from "next/link";

interface ModelPricing {
  model: string;
  inputPrice: number;
  outputPrice: number;
  cacheReadPrice: number;
  cacheWritePrice: number;
  updatedAt: string;
}

interface ModelUsage {
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

export default function PricingPage() {
  const [pricing, setPricing] = useState<ModelPricing[]>([]);
  const [modelUsage, setModelUsage] = useState<Record<string, ModelUsage>>({});
  const [editModel, setEditModel] = useState<ModelPricing | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [formData, setFormData] = useState({
    inputPrice: "",
    outputPrice: "",
    cacheReadPrice: "",
    cacheWritePrice: "",
  });
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchPricing = useCallback(async () => {
    const res = await fetch("/api/pricing");
    const data = await res.json();
    setPricing(data);
  }, []);

  const fetchUsage = useCallback(async () => {
    const res = await fetch("/api/usage");
    const data = await res.json();
    setModelUsage(data.byModel || {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPricing();
      fetchUsage();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchPricing, fetchUsage]);

  const handleSave = async (model: string) => {
    setSaveError(null);
    const res = await fetch("/api/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        inputPrice: parseFloat(formData.inputPrice) || 0,
        outputPrice: parseFloat(formData.outputPrice) || 0,
        cacheReadPrice: parseFloat(formData.cacheReadPrice) || 0,
        cacheWritePrice: parseFloat(formData.cacheWritePrice) || 0,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSaveError(data.error || "保存定价失败");
      return;
    }
    setEditModel(null);
    setIsAddOpen(false);
    setNewModel("");
    setFormData({
      inputPrice: "",
      outputPrice: "",
      cacheReadPrice: "",
      cacheWritePrice: "",
    });
    setSaveError(null);
    await fetchPricing();
    await fetchUsage();
  };

  const handleDelete = async (model: string) => {
    setSaveError(null);
    const res = await fetch(`/api/pricing?model=${encodeURIComponent(model)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json();
      setSaveError(data.error || "删除定价失败");
      return;
    }
    await fetchPricing();
    await fetchUsage();
  };

  const openEdit = (p: ModelPricing) => {
    setEditModel(p);
    setFormData({
      inputPrice: p.inputPrice.toString(),
      outputPrice: p.outputPrice.toString(),
      cacheReadPrice: p.cacheReadPrice.toString(),
      cacheWritePrice: p.cacheWritePrice.toString(),
    });
  };

  // All models from usage that don't have pricing yet
  const unpricedModels = Object.keys(modelUsage).filter(
    (m) => !pricing.find((p) => p.model === m)
  );

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  const formatCost = (cost: number): string => {
    if (cost === 0) return "$0.00";
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  const estimateCost = (model: string): string => {
    const usage = modelUsage[model];
    if (!usage) return "-";
    const input = (usage.input / 1_000_000) * (parseFloat(formData.inputPrice) || 0);
    const output = (usage.output / 1_000_000) * (parseFloat(formData.outputPrice) || 0);
    const cacheRead = (usage.cacheRead / 1_000_000) * (parseFloat(formData.cacheReadPrice) || 0);
    const cacheWrite = (usage.cacheWrite / 1_000_000) * (parseFloat(formData.cacheWritePrice) || 0);
    return formatCost(input + output + cacheRead + cacheWrite);
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
                  返回主面板
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  模型定价
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  设置每 100 万 Token 的单价以核算费用
                </p>
              </div>
            </div>
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger>
                <Button className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  添加定价
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>添加模型定价</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <Label>模型名称</Label>
                    <Input
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      placeholder="例如: claude-sonnet-4-20250514"
                      className="mt-1.5"
                    />
                    {unpricedModels.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-muted-foreground mb-1.5">
                          尚未配置定价的模型：
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {unpricedModels.map((m) => (
                            <Badge
                              key={m}
                              variant="outline"
                              className="cursor-pointer text-xs hover:bg-accent"
                              onClick={() => setNewModel(m)}
                            >
                              {m}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <PriceInputs
                    formData={formData}
                    setFormData={setFormData}
                    estimatedCost={newModel ? estimateCost(newModel) : null}
                    usage={newModel ? modelUsage[newModel] : undefined}
                  />
                  {saveError && (
                    <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                      {saveError}
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <DialogClose>
                      <Button variant="outline">取消</Button>
                    </DialogClose>
                    <Button
                      onClick={() => handleSave(newModel)}
                      disabled={!newModel}
                      className="gap-1.5"
                    >
                      <Save className="h-4 w-4" />
                      保存
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-6 py-6 space-y-6">
        {/* Configured Pricing */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              已配置定价
              <Badge variant="secondary" className="ml-1">
                {pricing.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pricing.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>暂无已配置的定价规则。</p>
                <p className="text-sm mt-1">
                  添加模型单价后，将自动根据 Token 用量核算花费。
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>模型</TableHead>
                    <TableHead className="text-right">
                      输入 $/1M
                    </TableHead>
                    <TableHead className="text-right">
                      输出 $/1M
                    </TableHead>
                    <TableHead className="text-right">
                      缓存读取 $/1M
                    </TableHead>
                    <TableHead className="text-right">
                      缓存写入 $/1M
                    </TableHead>
                    <TableHead className="text-right">
                      核算费用
                    </TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pricing.map((p) => (
                    <TableRow key={p.model}>
                      <TableCell className="font-mono text-sm">
                        {p.model}
                      </TableCell>
                      <TableCell className="text-right">
                        ${p.inputPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${p.outputPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${p.cacheReadPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${p.cacheWritePrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {modelUsage[p.model]
                          ? formatCost(modelUsage[p.model].cost)
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Dialog
                            open={editModel?.model === p.model}
                            onOpenChange={(open) => {
                              if (!open) setEditModel(null);
                            }}
                          >
                            <DialogTrigger>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEdit(p)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>
                                  编辑定价: {p.model}
                                </DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4 pt-2">
                                <PriceInputs
                                  formData={formData}
                                  setFormData={setFormData}
                                  estimatedCost={estimateCost(p.model)}
                                  usage={modelUsage[p.model]}
                                />
                                {saveError && (
                                  <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                                    {saveError}
                                  </div>
                                )}
                                <div className="flex justify-end gap-2 pt-2">
                                  <DialogClose>
                                    <Button variant="outline">取消</Button>
                                  </DialogClose>
                                  <Button
                                    onClick={() => handleSave(p.model)}
                                    className="gap-1.5"
                                  >
                                    <Save className="h-4 w-4" />
                                    保存
                                  </Button>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(p.model)}
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

        {/* All Models Usage */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              全部模型用量统计
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>模型</TableHead>
                  <TableHead className="text-right">输入 Token</TableHead>
                  <TableHead className="text-right">输出 Token</TableHead>
                  <TableHead className="text-right">缓存读取</TableHead>
                  <TableHead className="text-right">缓存写入</TableHead>
                  <TableHead className="text-right">总 Token</TableHead>
                  <TableHead className="text-right">费用</TableHead>
                  <TableHead className="text-right">定价状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(modelUsage)
                  .sort(([, a], [, b]) => b.tokens - a.tokens)
                  .map(([model, usage]) => (
                    <TableRow key={model}>
                      <TableCell className="font-mono text-sm">
                        {model}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatTokens(usage.input)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatTokens(usage.output)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatTokens(usage.cacheRead)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatTokens(usage.cacheWrite)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatTokens(usage.tokens)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCost(usage.cost)}
                      </TableCell>
                      <TableCell className="text-right">
                        {usage.hasPricing ? (
                          <Badge
                            variant="default"
                            className="text-xs bg-green-600"
                          >
                            已设置
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            未设置
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!usage.hasPricing && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setNewModel(model);
                              setFormData({
                                inputPrice: "",
                                outputPrice: "",
                                cacheReadPrice: "",
                                cacheWritePrice: "",
                              });
                              setIsAddOpen(true);
                            }}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        )}
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

function PriceInputs({
  formData,
  setFormData,
  estimatedCost,
  usage,
}: {
  formData: {
    inputPrice: string;
    outputPrice: string;
    cacheReadPrice: string;
    cacheWritePrice: string;
  };
  setFormData: (data: typeof formData) => void;
  estimatedCost: string | null;
  usage?: ModelUsage;
}) {
  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <div className="space-y-3">
      {usage && (
        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
          <p>
            <span className="font-medium">历史用量：</span>{" "}
            {formatTokens(usage.input)} 输入，{formatTokens(usage.output)}{" "}
            输出，{formatTokens(usage.cacheRead)} 缓存读取，{" "}
            {formatTokens(usage.cacheWrite)} 缓存写入
          </p>
          <p>
            <span className="font-medium">轮次：</span> {usage.turns} |{" "}
            <span className="font-medium">会话：</span> {usage.sessions}
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">提示词输入单价 ($/1M Token)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={formData.inputPrice}
            onChange={(e) =>
              setFormData({ ...formData, inputPrice: e.target.value })
            }
            placeholder="0.00"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">模型输出单价 ($/1M Token)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={formData.outputPrice}
            onChange={(e) =>
              setFormData({ ...formData, outputPrice: e.target.value })
            }
            placeholder="0.00"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">缓存读取单价 ($/1M Token)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={formData.cacheReadPrice}
            onChange={(e) =>
              setFormData({ ...formData, cacheReadPrice: e.target.value })
            }
            placeholder="0.00"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">缓存写入单价 ($/1M Token)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={formData.cacheWritePrice}
            onChange={(e) =>
              setFormData({ ...formData, cacheWritePrice: e.target.value })
            }
            placeholder="0.00"
            className="mt-1"
          />
        </div>
      </div>
      {estimatedCost && (
        <div className="rounded-md bg-primary/10 p-3 text-sm">
          <span className="font-medium">预估总花费：</span>{" "}
          <span className="text-primary font-bold">{estimatedCost}</span>
        </div>
      )}
    </div>
  );
}
