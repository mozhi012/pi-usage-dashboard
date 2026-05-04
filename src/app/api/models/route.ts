/**
 * Models & Providers API
 *
 * Returns all available models from:
 * - Custom providers in ~/.pi/agent/models.json
 * - OAuth-authenticated built-in providers from ~/.pi/agent/auth.json
 * - pi --list-models CLI output
 *
 * GET    /api/models                — List all models and providers
 * POST   /api/models                — Add a provider or model
 * PUT    /api/models                — Update a provider or model
 * DELETE /api/models?provider=x     — Delete a provider
 * DELETE /api/models?provider=x&modelId=y — Delete a model
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { exec } from "child_process";
import { requireMutationAuth } from "@/lib/api-security";

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

const MODELS_JSON_PATH = join(homedir(), ".pi", "agent", "models.json");
const SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");
const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function parseSize(str: string): number {
  if (!str) return 0;
  const cleaned = str.replace(/,/g, "");
  if (cleaned.endsWith("M")) return parseFloat(cleaned) * 1_000_000;
  if (cleaned.endsWith("K")) return parseFloat(cleaned) * 1_000;
  return parseInt(cleaned, 10) || 0;
}

async function findBuiltInModelsPath(): Promise<string> {
  try {
    const piPath = await new Promise<string>((resolve, reject) => {
      exec("which pi", (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    const { realpathSync } = await import("fs");
    const realPiPath = realpathSync(piPath);
    const parts = realPiPath.split("/");
    const binIdx = parts.lastIndexOf("bin");
    if (binIdx > 0) {
      const prefix = parts.slice(0, binIdx).join("/");
      const candidate = join(prefix, "lib", "node_modules", "@mariozechner", "pi-coding-agent", "node_modules", "@mariozechner", "pi-ai", "dist", "models.generated.js");
      if (await exists(candidate)) return candidate;
    }
    const pkgDir = join(realPiPath, "..", "..");
    const candidate2 = join(pkgDir, "node_modules", "@mariozechner", "pi-ai", "dist", "models.generated.js");
    if (await exists(candidate2)) return candidate2;
  } catch { /* skip */ }

  const home = homedir();
  const candidates = [
    join(home, ".npm-global", "lib", "node_modules", "@mariozechner", "pi-coding-agent", "node_modules", "@mariozechner", "pi-ai", "dist", "models.generated.js"),
    "/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/models.generated.js",
    "/usr/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/models.generated.js",
  ];
  for (const c of candidates) {
    if (await exists(c)) return c;
  }
  return "";
}

export async function GET() {
  try {
    const home = homedir();
    const modelsJsonPath = join(home, ".pi", "agent", "models.json");
    const settingsPath = join(home, ".pi", "agent", "settings.json");
    const authPath = join(home, ".pi", "agent", "auth.json");
    const builtInModelsPath = await findBuiltInModelsPath();

    const models: ModelInfo[] = [];
    const providers: Record<string, ProviderInfo> = {};

    // 1. Read auth.json
    let authData: Record<string, { type: string; [key: string]: unknown }> = {};
    if (await exists(authPath)) {
      try { authData = JSON.parse(await readFile(authPath, "utf-8")); } catch { /* skip */ }
    }

    // 2. Read custom providers from models.json
    if (await exists(modelsJsonPath)) {
      try {
        const content = await readFile(modelsJsonPath, "utf-8");
        const modelsJson = JSON.parse(content);
        const customProviders = modelsJson.providers || {};

        for (const [providerName, config] of Object.entries(customProviders)) {
          const cfg = config as {
            baseUrl?: string;
            apiKey?: string;
            api?: string;
            models?: Array<{
              id: string;
              name?: string;
              contextWindow?: number;
              maxTokens?: number;
              reasoning?: boolean;
              input?: string[];
              cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
            }>;
          };

          const hasApiKey = !!(cfg.apiKey && cfg.apiKey.length > 0);
          const hasOAuth = !!authData[providerName];

          providers[providerName] = {
            name: providerName,
            baseUrl: cfg.baseUrl || "",
            api: cfg.api || "unknown",
            hasAuth: hasApiKey || hasOAuth,
            authType: hasOAuth ? "oauth" : hasApiKey ? "api_key" : "none",
            modelCount: cfg.models?.length || 0,
            source: "custom",
            hasApiKey,
          };

          if (cfg.models) {
            for (const model of cfg.models) {
              models.push({
                id: model.id,
                name: model.name || model.id,
                provider: providerName,
                contextWindow: model.contextWindow || 0,
                maxTokens: model.maxTokens || 0,
                reasoning: model.reasoning || false,
                images: model.input?.includes("image") || false,
                cost: model.cost,
                source: "custom",
              });
            }
          }
        }
      } catch { /* skip */ }
    }

    // 3. Load built-in models from pi-ai
    if (builtInModelsPath && await exists(builtInModelsPath)) {
      try {
        const content = await readFile(builtInModelsPath, "utf-8");
        const modelRegex = /id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*api:\s*"([^"]+)",\s*provider:\s*"([^"]+)",\s*baseUrl:\s*"([^"]*)"[^}]*?reasoning:\s*(true|false)[^}]*?input:\s*\[([^\]]*)\][^}]*?cost:\s*\{[^}]*?input:\s*([\d.]+)[^}]*?output:\s*([\d.]+)[^}]*?cacheRead:\s*([\d.]+)[^}]*?cacheWrite:\s*([\d.]+)[^}]*?\}[^}]*?contextWindow:\s*(\d+)[^}]*?maxTokens:\s*(\d+)/g;

        let match;
        while ((match = modelRegex.exec(content)) !== null) {
          const [, id, name, , provider, , reasoning, input, costIn, costOut, cacheRead, cacheWrite, contextWindow, maxTokens] = match;

          const providerAuthKey = provider;
          const isAuthenticated = !!authData[providerAuthKey] ||
            !!authData[`${providerAuthKey}-gemini-cli`] ||
            !!providers[providerAuthKey];

          if (!isAuthenticated) continue;

          const existing = models.find(m => m.provider === provider && m.id === id);
          if (existing) continue;

          if (!providers[provider]) {
            const authEntry = authData[provider] || authData[`${provider}-gemini-cli`];
            providers[provider] = {
              name: provider,
              baseUrl: "",
              api: "built-in",
              hasAuth: !!authEntry,
              authType: authEntry?.type === "oauth" ? "oauth" : authEntry ? "api_key" : "none",
              modelCount: 0,
              source: "builtin",
            };
          }

          models.push({
            id,
            name,
            provider,
            contextWindow: parseInt(contextWindow) || 0,
            maxTokens: parseInt(maxTokens) || 0,
            reasoning: reasoning === "true",
            images: input.includes('"image"'),
            cost: {
              input: parseFloat(costIn) || 0,
              output: parseFloat(costOut) || 0,
              cacheRead: parseFloat(cacheRead) || 0,
              cacheWrite: parseFloat(cacheWrite) || 0,
            },
            source: "builtin",
          });
        }
      } catch { /* skip */ }
    }

    // 4. Try pi --list-models
    try {
      const output = await new Promise<string>((resolve, reject) => {
        exec("pi --list-models 2>&1", { timeout: 10000 }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });

      const lines = output.trim().split("\n");
      for (const line of lines) {
        if (line.startsWith("provider") || !line.trim()) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 6) {
          const [provider, modelId, context, maxOut, thinking, images] = parts;
          const existing = models.find(m => m.provider === provider && m.id === modelId);
          if (existing) continue;

          if (!providers[provider]) {
            providers[provider] = {
              name: provider,
              baseUrl: "",
              api: "unknown",
              hasAuth: true,
              authType: "api_key",
              modelCount: 0,
              source: "cli",
            };
          }

          models.push({
            id: modelId,
            name: modelId,
            provider,
            contextWindow: parseSize(context),
            maxTokens: parseSize(maxOut),
            reasoning: thinking === "yes",
            images: images === "yes",
            source: "cli",
          });
        }
      }
    } catch { /* skip */ }

    // Update model counts
    for (const provider of Object.keys(providers)) {
      providers[provider].modelCount = models.filter(m => m.provider === provider).length;
    }

    // Read settings
    let defaultProvider = "";
    let defaultModel = "";
    if (await exists(settingsPath)) {
      try {
        const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
        defaultProvider = settings.defaultProvider || "";
        defaultModel = settings.defaultModel || "";
      } catch { /* skip */ }
    }

    const authProviders = Object.entries(authData).map(([key, val]) => ({
      id: key,
      type: val.type as string,
    }));

    return NextResponse.json({
      models,
      providers,
      authProviders,
      defaultProvider,
      defaultModel,
      totalModels: models.length,
      totalProviders: Object.keys(providers).length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read models", details: String(error) },
      { status: 500 }
    );
  }
}

/** Read and parse the models.json file, returning the providers object. */
async function readModelsJson(): Promise<Record<string, any>> {
  if (!(await exists(MODELS_JSON_PATH))) return {};
  try {
    const content = await readFile(MODELS_JSON_PATH, "utf-8");
    const parsed = JSON.parse(content);
    return parsed.providers || {};
  } catch {
    return {};
  }
}

/** Write the providers object back to models.json, preserving other top-level keys. */
async function writeModelsJson(providers: Record<string, any>): Promise<void> {
  let existing: Record<string, any> = { providers: {} };
  if (await exists(MODELS_JSON_PATH)) {
    try {
      existing = JSON.parse(await readFile(MODELS_JSON_PATH, "utf-8"));
    } catch { /* ignore */ }
  }
  existing.providers = providers;
  await writeFile(MODELS_JSON_PATH, JSON.stringify(existing, null, 2) + "\n");
}

export async function POST(request: NextRequest) {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action } = body;

    if (!action || typeof action !== "string") {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const providers = await readModelsJson();

    if (action === "add-provider") {
      const { name, baseUrl, api, apiKey } = body;
      if (!name || typeof name !== "string") {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
      }
      if (!baseUrl || typeof baseUrl !== "string") {
        return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
      }
      if (!api || typeof api !== "string") {
        return NextResponse.json({ error: "api is required" }, { status: 400 });
      }
      if (providers[name]) {
        return NextResponse.json({ error: `Provider "${name}" already exists` }, { status: 409 });
      }
      providers[name] = {
        baseUrl,
        api,
        models: [],
      };
      if (apiKey && typeof apiKey === "string" && apiKey.length > 0) {
        providers[name].apiKey = apiKey;
      }
      await writeModelsJson(providers);
      return NextResponse.json({ success: true });
    }

    if (action === "add-model") {
      const { provider, model } = body;
      if (!provider || typeof provider !== "string") {
        return NextResponse.json({ error: "provider is required" }, { status: 400 });
      }
      if (!model || !model.id || typeof model.id !== "string") {
        return NextResponse.json({ error: "model.id is required" }, { status: 400 });
      }
      if (!providers[provider]) {
        return NextResponse.json({ error: `Provider "${provider}" not found` }, { status: 404 });
      }
      if (providers[provider].models?.find((m: any) => m.id === model.id)) {
        return NextResponse.json({ error: `Model "${model.id}" already exists in provider "${provider}"` }, { status: 409 });
      }
      providers[provider].models = providers[provider].models || [];
      // Only keep known fields
      providers[provider].models.push({
        id: model.id,
        name: model.name || model.id,
        contextWindow: model.contextWindow ?? 0,
        maxTokens: model.maxTokens ?? 0,
        ...(model.reasoning !== undefined && { reasoning: !!model.reasoning }),
        ...(model.input !== undefined && { input: model.input }),
        ...(model.cost !== undefined && { cost: model.cost }),
      });
      await writeModelsJson(providers);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update models", details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action } = body;

    if (!action || typeof action !== "string") {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const providers = await readModelsJson();

    if (action === "update-provider") {
      const { name, baseUrl, api, apiKey } = body;
      if (!name || typeof name !== "string") {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
      }
      if (!providers[name]) {
        return NextResponse.json({ error: `Provider "${name}" not found` }, { status: 404 });
      }
      if (baseUrl !== undefined) providers[name].baseUrl = baseUrl;
      if (api !== undefined) providers[name].api = api;
      if (apiKey !== undefined) {
        if (apiKey === "") {
          delete providers[name].apiKey;
        } else {
          providers[name].apiKey = apiKey;
        }
      }
      await writeModelsJson(providers);
      return NextResponse.json({ success: true });
    }

    if (action === "update-model") {
      const { provider, modelId, updates } = body;
      if (!provider || typeof provider !== "string") {
        return NextResponse.json({ error: "provider is required" }, { status: 400 });
      }
      if (!modelId || typeof modelId !== "string") {
        return NextResponse.json({ error: "modelId is required" }, { status: 400 });
      }
      if (!providers[provider]) {
        return NextResponse.json({ error: `Provider "${provider}" not found` }, { status: 404 });
      }
      const modelIdx = providers[provider].models?.findIndex((m: any) => m.id === modelId);
      if (modelIdx === undefined || modelIdx < 0) {
        return NextResponse.json({ error: `Model "${modelId}" not found in provider "${provider}"` }, { status: 404 });
      }
      const existing = providers[provider].models[modelIdx];
      if (updates.id !== undefined && typeof updates.id === "string") existing.id = updates.id;
      if (updates.name !== undefined) existing.name = updates.name;
      if (updates.contextWindow !== undefined) existing.contextWindow = updates.contextWindow;
      if (updates.maxTokens !== undefined) existing.maxTokens = updates.maxTokens;
      if (updates.reasoning !== undefined) existing.reasoning = !!updates.reasoning;
      if (updates.input !== undefined) existing.input = updates.input;
      if (updates.cost !== undefined) existing.cost = updates.cost;
      await writeModelsJson(providers);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update models", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const modelId = searchParams.get("modelId");

    if (!provider) {
      return NextResponse.json({ error: "provider query param is required" }, { status: 400 });
    }

    const providers = await readModelsJson();

    if (!providers[provider]) {
      return NextResponse.json({ error: `Provider "${provider}" not found` }, { status: 404 });
    }

    if (modelId) {
      // Delete a specific model
      const modelIdx = providers[provider].models?.findIndex((m: any) => m.id === modelId);
      if (modelIdx === undefined || modelIdx < 0) {
        return NextResponse.json({ error: `Model "${modelId}" not found` }, { status: 404 });
      }
      providers[provider].models.splice(modelIdx, 1);
      await writeModelsJson(providers);
      return NextResponse.json({ success: true, message: `Deleted model "${modelId}" from "${provider}"` });
    } else {
      // Delete the entire provider
      delete providers[provider];
      await writeModelsJson(providers);
      return NextResponse.json({ success: true, message: `Deleted provider "${provider}"` });
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete", details: String(error) },
      { status: 500 }
    );
  }
}
