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
 *      (action=set-model-scope)     — Include/exclude a model in Pi's enabledModels scope
 *      (action=reset-model-scope)   — Remove enabledModels (restore unrestricted scope)
 * DELETE /api/models?provider=x     — Delete a provider
 * DELETE /api/models?provider=x&modelId=y — Delete a model
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { requireMutationAuth } from "@/lib/api-security";
import {
  buildModelCatalog,
  modelInScope,
  computeScopedPatterns,
  scopeLeavesUsableModel,
  resolveScopedKeys,
  readSettingsStrict,
  writeSettingsAtomic,
  withSettingsLock,
  modelKey,
  SettingsScopeError,
  usableModelKeys,
} from "@/lib/model-scope";

const modelsJsonPath = join(homedir(), ".pi", "agent", "models.json");
const SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface ScopeMeta {
  active: boolean;
  patterns: string[];
  /** True when patterns exist but match no available model (Pi falls back to all). */
  fallback: boolean;
  readError?: string;
}

/**
 * Build the shared /api/models GET payload: full catalog + per-model
 * `inScope` flag + scope metadata + CLI catalog health (write protection).
 */
async function buildModelsResponse(): Promise<NextResponse> {
  const catalog = await buildModelCatalog();

  // Scope semantics are evaluated against the CLI-available catalogue (what
  // Pi can actually use); the full display catalogue may still contain
  // unauthenticated models, which are not counted for effective scope.
  const scopeCatalog = catalog.cliAvailable
    ? catalog.models.filter((m) => catalog.cliModelKeys.has(modelKey(m)))
    : catalog.models;

  // Lenient scope read for display: a broken settings.json must not hide the catalog.
  let scope: ScopeMeta = { active: false, patterns: [], fallback: false };
  try {
    const settings = await readSettingsStrict(SETTINGS_PATH);
    const patterns = Array.isArray(settings.enabledModels) ? settings.enabledModels : [];
    scope = {
      active: patterns.length > 0,
      patterns,
      fallback: patterns.length > 0 && resolveScopedKeys(patterns, scopeCatalog).size === 0,
    };
  } catch (err) {
    scope = {
      active: false,
      patterns: [],
      fallback: false,
      readError: err instanceof SettingsScopeError ? err.message : "无法读取 settings.json",
    };
  }

  const models = catalog.models.map((model) => ({
    ...model,
    inScope: scope.active ? modelInScope(scope.patterns, model, scopeCatalog) : true,
    available: catalog.cliAvailable && catalog.cliModelKeys.has(modelKey(model)),
  }));

  return NextResponse.json({
    models,
    providers: catalog.providers,
    authProviders: catalog.authProviders,
    defaultProvider: catalog.settings.defaultProvider,
    defaultModel: catalog.settings.defaultModel,
    totalModels: models.length,
    totalProviders: Object.keys(catalog.providers).length,
    scope,
    catalogOk: catalog.cliAvailable,
  });
}

export async function GET() {
  try {
    return await buildModelsResponse();
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read models", details: String(error) },
      { status: 500 }
    );
  }
}

/** Read and parse the models.json file, returning the providers object. */
async function readModelsJson(): Promise<Record<string, any>> {
  if (!(await exists(modelsJsonPath))) return {};
  try {
    const content = await readFile(modelsJsonPath, "utf-8");
    const parsed = JSON.parse(content);
    return parsed.providers || {};
  } catch {
    return {};
  }
}

/** Write the providers object back to models.json, preserving other top-level keys. */
async function writeModelsJson(providers: Record<string, any>): Promise<void> {
  let existing: Record<string, any> = { providers: {} };
  if (await exists(modelsJsonPath)) {
    try {
      existing = JSON.parse(await readFile(modelsJsonPath, "utf-8"));
    } catch {
      /* ignore */
    }
  }
  existing.providers = providers;
  await writeFile(modelsJsonPath, JSON.stringify(existing, null, 2) + "\n");
}

/** Parse a JSON object body; null when missing/invalid (callers return 400). */
async function readJsonBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Typed view over the JSON body used by provider/model mutation actions. */
interface ModelBodyInput {
  id?: unknown;
  name?: unknown;
  contextWindow?: unknown;
  maxTokens?: unknown;
  reasoning?: unknown;
  input?: unknown;
  cost?: unknown;
}
type MutationBody = Record<string, unknown> & {
  model?: ModelBodyInput;
  updates?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const body = await readJsonBody(request);
    if (!body) {
      return NextResponse.json({ error: "Body must be a valid JSON object" }, { status: 400 });
    }
    const mutation = body as MutationBody;
    const { action } = mutation;

    if (!action || typeof action !== "string") {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const providers = await readModelsJson();

    if (action === "add-provider") {
      const { name, baseUrl, api, apiKey } = mutation;
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
      const { provider, model } = mutation;
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
    const body = await readJsonBody(request);
    if (!body) {
      return NextResponse.json({ error: "Body must be a valid JSON object" }, { status: 400 });
    }
    const mutation = body as MutationBody;
    const { action } = mutation;

    if (!action || typeof action !== "string") {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    if (action === "set-model-scope" || action === "reset-model-scope") {
      return await handleScopeAction(action, body);
    }

    const providers = await readModelsJson();

    if (action === "update-provider") {
      const { name, baseUrl, api, apiKey } = mutation;
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
      const { provider, modelId, updates } = mutation;
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
      const modelUpdates: Record<string, unknown> = updates ?? {};
      if (modelUpdates.id !== undefined && typeof modelUpdates.id === "string") existing.id = modelUpdates.id;
      if (modelUpdates.name !== undefined) existing.name = modelUpdates.name;
      if (modelUpdates.contextWindow !== undefined) existing.contextWindow = modelUpdates.contextWindow;
      if (modelUpdates.maxTokens !== undefined) existing.maxTokens = modelUpdates.maxTokens;
      if (modelUpdates.reasoning !== undefined) existing.reasoning = !!modelUpdates.reasoning;
      if (modelUpdates.input !== undefined) existing.input = modelUpdates.input;
      if (modelUpdates.cost !== undefined) existing.cost = modelUpdates.cost;
      await writeModelsJson(providers);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    if (error instanceof SettingsScopeError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "Failed to update models", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * PUT action=set-model-scope { provider, modelId, inScope: boolean }
 *   / reset-model-scope
 *
 * These only touch `enabledModels` in settings.json (Pi's model selection
 * scope). They never delete models/auth or change defaultProvider/defaultModel.
 */
async function handleScopeAction(action: string, body: Record<string, unknown>): Promise<NextResponse> {
  if (action === "reset-model-scope") {
    return withSettingsLock(SETTINGS_PATH, async () => {
      const settings = await readSettingsStrict(SETTINGS_PATH);
      if (settings.enabledModels !== undefined) {
        const next = { ...settings };
        delete next.enabledModels;
        await writeSettingsAtomic(SETTINGS_PATH, next);
      }
      const refreshed = await buildModelsResponse();
      return NextResponse.json({ success: true, ...(await refreshed.json()) });
    });
  }

  // set-model-scope
  const { provider, modelId, inScope } = body;
  if (typeof provider !== "string" || !provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }
  if (typeof modelId !== "string" || !modelId) {
    return NextResponse.json({ error: "modelId is required" }, { status: 400 });
  }
  if (typeof inScope !== "boolean") {
    return NextResponse.json({ error: "inScope must be a boolean" }, { status: 400 });
  }

  // Build the catalog in-process (no network self-calls). The CLI list is the
  // authoritative "actually available" set; without it we refuse to rewrite
  // the scope so a partial catalog cannot clobber the allowlist.
  const catalog = await buildModelCatalog();
  if (!catalog.cliAvailable) {
    return NextResponse.json(
      { error: "无法获取 pi --list-models 目录，为避免用不完整目录覆盖选择范围，已放弃本次修改" },
      { status: 503 }
    );
  }

  const target = catalog.models.find((m) => m.provider === provider && m.id === modelId);
  if (!target) {
    return NextResponse.json(
      { error: `Model "${modelId}" not found in provider "${provider}"` },
      { status: 404 }
    );
  }

  // Scope semantics are evaluated against the CLI-available catalogue; a
  // model that is not actually usable (e.g. custom provider without valid
  // credentials) must not be added to or removed from the scope.
  const scopeCatalog = catalog.models.filter((m) => catalog.cliModelKeys.has(modelKey(m)));
  if (!catalog.cliModelKeys.has(modelKey(target))) {
    return NextResponse.json(
      { error: `模型 "${modelKey(target)}" 当前不可用（无凭据或未出现在 pi --list-models 目录），请先完成认证后再设置范围` },
      { status: 400 }
    );
  }

  return withSettingsLock(SETTINGS_PATH, async () => {
    // Serialize same-process mutations and re-read immediately before saving.
    // Other processes do not share this lock; concurrent external edits are
    // still possible. Only enabledModels is changed in this snapshot.
    const settings = await readSettingsStrict(SETTINGS_PATH);
    const patterns: string[] | null = Array.isArray(settings.enabledModels)
      ? settings.enabledModels
      : null;

    const result = computeScopedPatterns({
      patterns,
      target: { provider: target.provider, id: target.id },
      action: inScope ? "include" : "exclude",
      catalog: scopeCatalog,
    });

    if (inScope && !result.changed) {
      const refreshed = await buildModelsResponse();
      return NextResponse.json({ success: true, message: "模型已在选择范围内", ...(await refreshed.json()) });
    }

    if (!inScope && !scopeLeavesUsableModel(result.patterns, usableModelKeys(catalog), scopeCatalog)) {
      return NextResponse.json(
        { error: `不能排除 "${modelKey(target)}"：排除后模型选择范围将没有任何可用模型` },
        { status: 400 }
      );
    }

    if (result.changed) {
      const next = { ...settings, enabledModels: result.patterns };
      await writeSettingsAtomic(SETTINGS_PATH, next);
    }

    const refreshed = await buildModelsResponse();
    return NextResponse.json({ success: true, ...(await refreshed.json()) });
  });
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
