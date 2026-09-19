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
  Puzzle,
  BookOpen,
  FileText,
  Palette,
  Package,
  RefreshCw,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";

interface ResourceItem {
  name: string;
  type: "extension" | "skill" | "prompt" | "theme";
  scope: "global" | "package";
  path: string;
  description?: string;
  packageName?: string;
}

export default function ExtensionsPage() {
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ResourceItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/extensions");
      const data = await res.json();
      setItems(data);
    } catch (err) {
      console.error("Failed to fetch extensions:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchItems, 0);
    return () => clearTimeout(timer);
  }, [fetchItems]);

  const extensions = items.filter((i) => i.type === "extension");
  const skills = items.filter((i) => i.type === "skill");
  const prompts = items.filter((i) => i.type === "prompt");
  const themes = items.filter((i) => i.type === "theme");

  const typeIcon = (type: string) => {
    switch (type) {
      case "extension":
        return <Puzzle className="h-3.5 w-3.5" />;
      case "skill":
        return <BookOpen className="h-3.5 w-3.5" />;
      case "prompt":
        return <FileText className="h-3.5 w-3.5" />;
      case "theme":
        return <Palette className="h-3.5 w-3.5" />;
      default:
        return null;
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/extensions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: deleteTarget.path,
          type: deleteTarget.type,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotification({ type: "error", message: data.error || "删除失败" });
      } else {
        const typeLabel = deleteTarget.type === "extension" ? "扩展" : deleteTarget.type === "skill" ? "技能" : deleteTarget.type === "prompt" ? "提示词模板" : "主题";
        setNotification({ type: "success", message: `已移除${typeLabel}：${deleteTarget.name}` });
        await fetchItems();
      }
    } catch (err) {
      setNotification({ type: "error", message: String(err) });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
      setTimeout(() => setNotification(null), 4000);
    }
  };

  const renderTable = (resourceItems: ResourceItem[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>来源</TableHead>
          <TableHead>描述</TableHead>
          <TableHead>路径</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {resourceItems.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
              暂无数据
            </TableCell>
          </TableRow>
        ) : (
          resourceItems.map((item, i) => (
            <TableRow key={`${item.path}-${i}`}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>
                {item.scope === "package" ? (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Package className="h-3 w-3" />
                    {item.packageName || "package"}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">
                    全局
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                {item.description || "—"}
              </TableCell>
              <TableCell className="font-mono text-xs max-w-[250px] truncate text-muted-foreground">
                {item.path}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteTarget(item)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

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
                  扩展与技能
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  所有全局可用的 Pi 资源
                </p>
              </div>
            </div>
            <Button
              onClick={fetchItems}
              disabled={loading}
              variant="outline"
              className="gap-1.5"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              刷新
            </Button>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-6 py-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  扩展 (Extensions)
                </span>
                <Puzzle className="h-4 w-4 text-chart-1" />
              </div>
              <div className="text-2xl font-bold">{extensions.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  技能 (Skills)
                </span>
                <BookOpen className="h-4 w-4 text-chart-2" />
              </div>
              <div className="text-2xl font-bold">{skills.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  提示词 (Prompts)
                </span>
                <FileText className="h-4 w-4 text-chart-4" />
              </div>
              <div className="text-2xl font-bold">{prompts.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  主题 (Themes)
                </span>
                <Palette className="h-4 w-4 text-chart-5" />
              </div>
              <div className="text-2xl font-bold">{themes.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Tabbed content */}
        <Card>
          <CardContent className="pt-4">
            <Tabs defaultValue="extensions">
              <TabsList>
                <TabsTrigger value="extensions" className="gap-1.5">
                  {typeIcon("extension")}
                  扩展 ({extensions.length})
                </TabsTrigger>
                <TabsTrigger value="skills" className="gap-1.5">
                  {typeIcon("skill")}
                  技能 ({skills.length})
                </TabsTrigger>
                <TabsTrigger value="prompts" className="gap-1.5">
                  {typeIcon("prompt")}
                  提示词 ({prompts.length})
                </TabsTrigger>
                <TabsTrigger value="themes" className="gap-1.5">
                  {typeIcon("theme")}
                  主题 ({themes.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="extensions" className="mt-4">
                {renderTable(extensions)}
              </TabsContent>
              <TabsContent value="skills" className="mt-4">
                {renderTable(skills)}
              </TabsContent>
              <TabsContent value="prompts" className="mt-4">
                {renderTable(prompts)}
              </TabsContent>
              <TabsContent value="themes" className="mt-4">
                {renderTable(themes)}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        {/* Notification */}
        {notification && (
          <div
            className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg ${
              notification.type === "success"
                ? "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400"
                : "bg-destructive/10 border-destructive/20 text-destructive"
            }`}
          >
            {notification.message}
          </div>
        )}
      </main>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              确认移除{deleteTarget?.type === "skill" ? "技能" : deleteTarget?.type === "extension" ? "扩展" : deleteTarget?.type === "prompt" ? "提示词模板" : "主题"}？
            </DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-4 pt-2">
              <div className="rounded-md bg-muted/50 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">名称</span>
                  <span className="font-medium text-sm">{deleteTarget.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">类型</span>
                  <Badge variant="outline" className="text-xs">
                    {deleteTarget.type === "skill" ? "技能 (skill)" : deleteTarget.type === "extension" ? "扩展 (extension)" : deleteTarget.type === "prompt" ? "提示词 (prompt)" : "主题 (theme)"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">来源</span>
                  <Badge
                    variant={deleteTarget.scope === "package" ? "outline" : "secondary"}
                    className="text-xs"
                  >
                    {deleteTarget.scope === "package"
                      ? deleteTarget.packageName || "package"
                      : "全局"}
                  </Badge>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">路径</span>
                  <p className="font-mono text-xs mt-0.5 break-all">
                    {deleteTarget.path}
                  </p>
                </div>
              </div>

              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                此操作将从磁盘永久删除该{deleteTarget.type === "skill" ? "技能目录" : "文件"}，无法撤销。
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDeleteTarget(null)}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="gap-1.5"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? "正在移除..." : "确认移除"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
