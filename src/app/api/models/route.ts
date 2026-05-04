/**
 * Models & Providers API
 *
 * Returns all available models from:
 * - Custom providers in ~/.pi/agent/models.json
 * - OAuth-authenticated built-in providers from ~/.pi/agent/auth.json
 * - pi --list-models CLI output
 *
 * GET /api/models
 */
import { NextResponse } from "next/server";
import { readFile, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { exec } from "child_process";

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

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/**
 * Locate the built-in models.generated.js from pi's installation.
 * Resolves the path dynamically using `which pi` to find the install location.
 */
async function findBuiltInModelsPath(): Promise<string> {
  // Try to resolve via `which pi` → follow symlinks to find package root
  try {
    const piPath = await new Promise<string>((resolve, reject) => {
      exec("which pi", (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });

    // Follow the path: bin/pi -> ../lib/node_modules/@mariozechner/pi-coding-agent
    const { realpathSync } = await import("fs");
    const realPiPath = realpathSync(piPath);
    // Go up from bin to package root
    const parts = realPiPath.split("/");
    const binIdx = parts.lastIndexOf("bin");
    if (binIdx > 0) {
      const prefix = parts.slice(0, binIdx).join("/");
      const candidate = join(prefix, "lib", "node_modules", "@mariozechner", "pi-coding-agent", "node_modules", "@mariozechner", "pi-ai", "dist", "models.generated.js");
      if (await exists(candidate)) return candidate;
    }

    // Try relative to the real path of the pi binary
    const pkgDir = join(realPiPath, "..", "..");
    const candidate2 = join(pkgDir, "node_modules", "@mariozechner", "pi-ai", "dist", "models.generated.js");
    if (await exists(candidate2)) return candidate2;
  } catch {
    // which pi failed
  }

  // Fallback: common global npm locations
  const home = homedir();
  const candidates = [
    join(home, ".npm-global", "lib", "node_modules", "@mariozechner", "pi-coding-agent", "node_modules", "@mariozechner", "pi-ai", "dist", "models.generated.js"),
    "/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/models.generated.js",
    "/usr/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/models.generated.js",
  ];

  for (const c of candidates) {
    if (await exists(c)) return c;
  }

  return ""; // Not found
}

export async function GET() {
  try {
    const home = homedir();
    const modelsJsonPath = join(home, ".pi", "agent", "models.json");
    const settingsPath = join(home, ".pi", "agent", "settings.json");
    const authPath = join(home, ".pi", "agent", "auth.json");
    // Try to find the built-in models file from pi's installation
    // Works regardless of how pi was installed (npm global, nvm, volta, etc.)
    const builtInModelsPath = await findBuiltInModelsPath();

    const models: ModelInfo[] = [];
    const providers: Record<string, ProviderInfo> = {};

    // 1. Read auth.json to know which providers are authenticated
    let authData: Record<string, { type: string; [key: string]: unknown }> = {};
    if (await exists(authPath)) {
      try {
        authData = JSON.parse(await readFile(authPath, "utf-8"));
      } catch { /* skip */ }
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
              });
            }
          }
        }
      } catch { /* skip */ }
    }

    // 3. Load built-in models from pi-ai (only for authenticated providers)
    if (builtInModelsPath && await exists(builtInModelsPath)) {
      try {
        const content = await readFile(builtInModelsPath, "utf-8");
        // Extract model data from the JS module
        // The file exports an object with provider keys containing model objects
        // We'll parse it by extracting the JSON-like data

        // Find all provider/model entries using regex on the compiled JS
        const modelRegex = /id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*api:\s*"([^"]+)",\s*provider:\s*"([^"]+)",\s*baseUrl:\s*"([^"]*)"[^}]*?reasoning:\s*(true|false)[^}]*?input:\s*\[([^\]]*)\][^}]*?cost:\s*\{[^}]*?input:\s*([\d.]+)[^}]*?output:\s*([\d.]+)[^}]*?cacheRead:\s*([\d.]+)[^}]*?cacheWrite:\s*([\d.]+)[^}]*?\}[^}]*?contextWindow:\s*(\d+)[^}]*?maxTokens:\s*(\d+)/g;

        let match;
        while ((match = modelRegex.exec(content)) !== null) {
          const [, id, name, , provider, , reasoning, input, costIn, costOut, cacheRead, cacheWrite, contextWindow, maxTokens] = match;

          // Only include if provider is authenticated
          const providerAuthKey = provider; // e.g., "google", "anthropic", "openai"
          const isAuthenticated = !!authData[providerAuthKey] ||
            !!authData[`${providerAuthKey}-gemini-cli`] ||
            !!providers[providerAuthKey]; // already in custom providers

          if (!isAuthenticated) continue;

          // Skip if already added from models.json
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
          });
        }
      } catch { /* skip */ }
    }

    // 4. Also try pi --list-models for any models we missed
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
          const key = `${provider}/${modelId}`;
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

    // Auth summary
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

function parseSize(str: string): number {
  if (!str) return 0;
  const cleaned = str.replace(/,/g, "");
  if (cleaned.endsWith("M")) return parseFloat(cleaned) * 1_000_000;
  if (cleaned.endsWith("K")) return parseFloat(cleaned) * 1_000;
  return parseInt(cleaned, 10) || 0;
}
