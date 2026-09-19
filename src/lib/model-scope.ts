/**
 * Model selection scope management (enabledModels in ~/.pi/agent/settings.json).
 *
 * This module mirrors Pi's own model-scoping semantics
 * (pi-coding-agent/dist/core/model-resolver.js):
 * - `enabledModels` missing or `[]` -> no scope (all models selectable).
 * - Patterns match either "provider/id" or a bare model id; glob patterns
 *   (* ? [) are matched with minimatch (nocase) against both forms.
 * - A trailing ":<thinking>" suffix (off/minimal/low/medium/high/xhigh/max)
 *   is a valid thinking level, not part of the model id.
 * - When patterns exist but match no model, Pi falls back to "all models".
 *
 * The module also hosts the shared model-catalog builder used by the
 * /api/models route (custom models.json + pi-ai builtin models +
 * `pi --list-models`), so GET and scope mutations operate on the same
 * catalog without any network self-calls.
 */
import { readFile, writeFile, rename, mkdir, rm, access } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { exec } from "child_process";
import { realpathSync } from "fs";
import { randomBytes } from "crypto";
import { minimatch } from "minimatch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal model identity used for scope matching. */
export interface ScopeModel {
  provider: string;
  id: string;
  name?: string;
}

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CatalogModel extends ScopeModel {
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  images: boolean;
  cost?: ModelCost;
  source: "custom" | "builtin" | "cli";
}

export interface CatalogProvider {
  name: string;
  baseUrl: string;
  api: string;
  hasAuth: boolean;
  authType: "api_key" | "oauth" | "none";
  modelCount: number;
  source: "custom" | "builtin" | "cli";
  hasApiKey?: boolean;
}

export interface ModelCatalog {
  models: CatalogModel[];
  providers: Record<string, CatalogProvider>;
  authProviders: Array<{ id: string; type: string }>;
  settings: { defaultProvider: string; defaultModel: string };
  /** True when `pi --list-models` succeeded (used as write protection). */
  cliAvailable: boolean;
  /** Canonical keys of the models the pi CLI currently reports as available. */
  cliModelKeys: Set<string>;
}

// ---------------------------------------------------------------------------
// Pattern / matching helpers (mirror pi model-resolver semantics)
// ---------------------------------------------------------------------------

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function modelKey(m: ScopeModel): string {
  return `${m.provider}/${m.id}`;
}

export function isGlobPattern(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

/**
 * Strip a valid ":<thinking>" suffix from a glob pattern.
 * Only the LAST colon is considered (ids may contain colons, e.g. OpenRouter).
 */
export function splitThinkingSuffix(pattern: string): { pattern: string; level?: string } {
  const idx = pattern.lastIndexOf(":");
  if (idx !== -1) {
    const suffix = pattern.slice(idx + 1);
    if ((THINKING_LEVELS as readonly string[]).includes(suffix)) {
      return { pattern: pattern.slice(0, idx), level: suffix };
    }
  }
  return { pattern };
}

function isAlias(id: string): boolean {
  if (id.endsWith("-latest")) return true;
  return !/-\d{8}$/.test(id);
}

/**
 * Exact model reference match (mirrors pi's findExactModelReferenceMatch):
 * canonical "provider/id" first, then explicit "provider/id" split, then a
 * unique bare id. Ambiguous matches resolve to undefined.
 */
function findExactReferenceMatch(pattern: string, catalog: ScopeModel[]): string | undefined {
  const normalized = pattern.trim().toLowerCase();
  if (!normalized) return undefined;

  const canonical = catalog.filter((m) => modelKey(m).toLowerCase() === normalized);
  if (canonical.length === 1) return modelKey(canonical[0]);
  if (canonical.length > 1) return undefined;

  const slashIdx = pattern.indexOf("/");
  if (slashIdx !== -1) {
    const provider = pattern.slice(0, slashIdx).trim();
    const id = pattern.slice(slashIdx + 1).trim();
    if (provider && id) {
      const matches = catalog.filter(
        (m) => m.provider.toLowerCase() === provider.toLowerCase() && m.id.toLowerCase() === id.toLowerCase()
      );
      if (matches.length === 1) return modelKey(matches[0]);
      if (matches.length > 0) return undefined;
    }
  }

  const byId = catalog.filter((m) => m.id.toLowerCase() === normalized);
  return byId.length === 1 ? modelKey(byId[0]) : undefined;
}

/**
 * Resolve a non-glob pattern to at most one model (mirrors pi's tryMatchModel):
 * exact reference match, then substring fallback over id/name preferring
 * non-dated aliases, then the highest sorting id.
 */
function tryMatchPattern(pattern: string, catalog: ScopeModel[]): string | undefined {
  const exact = findExactReferenceMatch(pattern, catalog);
  if (exact) return exact;

  const lower = pattern.toLowerCase();
  const matches = catalog.filter(
    (m) => m.id.toLowerCase().includes(lower) || (m.name || "").toLowerCase().includes(lower)
  );
  if (matches.length === 0) return undefined;

  const aliases = matches.filter((m) => isAlias(m.id));
  const pool = aliases.length > 0 ? aliases : matches;
  const sorted = [...pool].sort((a, b) => b.id.localeCompare(a.id));
  return modelKey(sorted[0]);
}

/**
 * Resolve a non-glob pattern the way pi's parseModelPattern does: try the
 * full pattern first (so ids containing colons are not mis-split), then
 * repeatedly strip trailing ":<suffix>" segments and retry the prefix
 * (recursion: "id:high:max" -> "id:high" -> "id").
 */
export function resolvePattern(pattern: string, catalog: ScopeModel[]): string | undefined {
  let current = pattern;
  for (;;) {
    const direct = tryMatchPattern(current, catalog);
    if (direct) return direct;
    const colonIdx = current.lastIndexOf(":");
    if (colonIdx === -1) return undefined;
    current = current.slice(0, colonIdx);
    if (!current) return undefined;
  }
}

/** All canonical keys matched by a glob pattern (after stripping a valid thinking suffix). */
function globMatchedKeys(globPattern: string, catalog: ScopeModel[]): Set<string> {
  const exact = findExactReferenceMatch(globPattern, catalog);
  if (exact) return new Set([exact]);

  const keys = new Set<string>();
  for (const m of catalog) {
    const key = modelKey(m);
    if (minimatch(key, globPattern, { nocase: true }) || minimatch(m.id, globPattern, { nocase: true })) {
      keys.add(key);
    }
  }
  return keys;
}

/** Whether a scope pattern covers a given model, given the full catalog. */
export function patternCoversModel(pattern: string, model: ScopeModel, catalog: ScopeModel[]): boolean {
  if (isGlobPattern(pattern)) {
    const { pattern: globPattern } = splitThinkingSuffix(pattern);
    return globMatchedKeys(globPattern, catalog).has(modelKey(model));
  }
  return resolvePattern(pattern, catalog) === modelKey(model);
}

/**
 * All canonical keys covered by a pattern list.
 * An empty result means Pi would fall back to "all models" (no effective scope).
 */
export function resolveScopedKeys(patterns: string[] | null | undefined, catalog: ScopeModel[]): Set<string> {
  const keys = new Set<string>();
  if (!patterns) return keys;
  for (const pattern of patterns) {
    if (isGlobPattern(pattern)) {
      const { pattern: globPattern } = splitThinkingSuffix(pattern);
      for (const key of globMatchedKeys(globPattern, catalog)) keys.add(key);
    } else {
      const key = resolvePattern(pattern, catalog);
      if (key) keys.add(key);
    }
  }
  return keys;
}

/**
 * Whether a model is within the selection scope.
 * No patterns, or patterns that match nothing (Pi falls back to all),
 * both count as "in scope".
 */
export function modelInScope(
  patterns: string[] | null | undefined,
  model: ScopeModel,
  catalog: ScopeModel[]
): boolean {
  if (!patterns || patterns.length === 0) return true;
  if (resolveScopedKeys(patterns, catalog).size === 0) return true;
  return patterns.some((p) => patternCoversModel(p, model, catalog));
}

// ---------------------------------------------------------------------------
// Scope pattern computation (include / exclude)
// ---------------------------------------------------------------------------

export interface ComputeScopeArgs {
  /** Current enabledModels; null/[] means "no scope". */
  patterns: string[] | null;
  target: { provider: string; id: string };
  action: "include" | "exclude";
  catalog: ScopeModel[];
}

export interface ComputeScopeResult {
  patterns: string[];
  changed: boolean;
  /** Exact entries created by expanding covering rules. */
  expanded: string[];
  /** Rules removed by the operation. */
  removedRules: string[];
}

/**
 * Compute the next enabledModels list.
 *
 * - include: appends the exact "provider/id" when the model is not already
 *   in scope. Wildcard rules are never auto-restored.
 * - exclude:
 *   - no effective scope -> explicit allowlist of the whole catalog minus
 *     the target (the only way to remove one model from "all");
 *   - effective scope -> every rule covering the target is handled: glob
 *     rules are expanded into the other models they match (preserving their
 *     thinking suffix), single-model rules are dropped. All other rules are
 *     kept verbatim, including rules that match nothing.
 *
 * Negative "!" patterns are never produced (Pi has no blacklist semantics).
 */
export function computeScopedPatterns(args: ComputeScopeArgs): ComputeScopeResult {
  const { patterns, target, action, catalog } = args;
  const targetKey = modelKey(target);
  const active = !!patterns && patterns.length > 0;
  // Pi falls back to "all models" when patterns match nothing.
  const effectivelyScoped = active && resolveScopedKeys(patterns, catalog).size > 0;

  if (action === "include") {
    if (!effectivelyScoped || modelInScope(patterns, target, catalog)) {
      return { patterns: patterns ?? [], changed: false, expanded: [], removedRules: [] };
    }
    return { patterns: [...patterns!, targetKey], changed: true, expanded: [targetKey], removedRules: [] };
  }

  // exclude
  if (!effectivelyScoped) {
    // Pi would show all models (no scope, or rules that match nothing).
    // Keep the original (non-matching) rules verbatim and append explicit
    // entries for the current catalog minus the target.
    const originals = patterns ?? [];
    const next = [...originals];
    const seen = new Set(next.map((p) => p.toLowerCase()));
    for (const key of catalog.map(modelKey)) {
      if (key === targetKey) continue;
      if (seen.has(key.toLowerCase())) continue;
      seen.add(key.toLowerCase());
      next.push(key);
    }
    return { patterns: next, changed: true, expanded: next.slice(originals.length), removedRules: [] };
  }

  const next: string[] = [];
  const expanded: string[] = [];
  const removedRules: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns!) {
    if (!patternCoversModel(pattern, target, catalog)) {
      next.push(pattern);
      continue;
    }
    removedRules.push(pattern);
    if (isGlobPattern(pattern)) {
      const { pattern: globPattern, level } = splitThinkingSuffix(pattern);
      const entries: string[] = [];
      for (const key of globMatchedKeys(globPattern, catalog)) {
        if (key === targetKey) continue;
        entries.push(level ? `${key}:${level}` : key);
      }
      for (const entry of entries) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        next.push(entry);
        expanded.push(entry);
      }
    }
    // Non-glob rules resolve to a single model (the target): dropped entirely.
  }
  return { patterns: next, changed: true, expanded, removedRules };
}

/**
 * Whether an exclude operation is valid:
 * the resulting scope must effectively cover at least one usable model and
 * must not degenerate into Pi's "all models" fallback (an empty explicit list
 * or all-no-match rules would silently bring the excluded model back).
 * `usable` is the set of canonical keys the pi CLI can actually use
 * (custom models without credentials are expected to be excluded from it).
 */
export function scopeLeavesUsableModel(
  patterns: string[],
  usable: Set<string>,
  catalog: ScopeModel[]
): boolean {
  if (patterns.length === 0) return false; // writing [] would restore all models
  const scoped = resolveScopedKeys(patterns, catalog);
  if (scoped.size === 0) return false; // Pi would fall back to all models
  for (const key of usable) {
    if (scoped.has(key)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// settings.json access (strict, atomic, serialized)
// ---------------------------------------------------------------------------

export class SettingsScopeError extends Error {}

/** Loose settings shape: we only own `enabledModels` and preserve the rest. */
export type PiSettings = Record<string, unknown>;

export function defaultSettingsPath(): string {
  return join(homedir(), ".pi", "agent", "settings.json");
}

/**
 * Strictly read settings.json:
 * - missing file -> {}
 * - invalid JSON / non-object root / invalid enabledModels -> throw
 *   (we must never silently overwrite a file we do not understand)
 */
export async function readSettingsStrict(settingsPath: string): Promise<PiSettings> {
  let content: string;
  try {
    content = await readFile(settingsPath, "utf-8");
  } catch (err) {
    if ((err as { code?: string } | undefined)?.code === "ENOENT") return {};
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new SettingsScopeError("settings.json 不是有效的 JSON，已拒绝覆盖该文件");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SettingsScopeError("settings.json 顶层必须是 JSON 对象，已拒绝覆盖该文件");
  }
  const settings = parsed as PiSettings;
  if (
    settings.enabledModels !== undefined &&
    (!Array.isArray(settings.enabledModels) || settings.enabledModels.some((x) => typeof x !== "string"))
  ) {
    throw new SettingsScopeError("settings.json 中的 enabledModels 不是字符串数组，已拒绝覆盖该文件");
  }
  return settings;
}

/** Atomic write: temp file (0o600) in the same directory + rename. */
export async function writeSettingsAtomic(settingsPath: string, settings: PiSettings): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(tmp, JSON.stringify(settings, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
    await rename(tmp, settingsPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

const settingsLocks = new Map<string, Promise<void>>();

/**
 * Serialize settings read-modify-write cycles per file path within this
 * process. Cross-process changes are still handled by re-reading the latest
 * file inside the critical section (only enabledModels is rewritten).
 */
export function withSettingsLock<T>(settingsPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = settingsLocks.get(settingsPath) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  settingsLocks.set(
    settingsPath,
    run.then(() => undefined, () => undefined)
  );
  return run;
}

// ---------------------------------------------------------------------------
// Model catalog (shared by /api/models GET and scope mutations)
// ---------------------------------------------------------------------------

function parseSize(str: string): number {
  if (!str) return 0;
  const cleaned = str.replace(/,/g, "").toUpperCase();
  if (cleaned.endsWith("G")) return parseFloat(cleaned) * 1_000_000_000;
  if (cleaned.endsWith("M")) return parseFloat(cleaned) * 1_000_000;
  if (cleaned.endsWith("K")) return parseFloat(cleaned) * 1_000;
  return parseInt(cleaned, 10) || 0;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findBuiltInModelsPath(): Promise<string> {
  try {
    const piPath = await new Promise<string>((resolve, reject) => {
      exec("which pi", (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    const realPiPath = realpathSync(piPath);
    const parts = realPiPath.split("/");
    const binIdx = parts.lastIndexOf("bin");
    if (binIdx > 0) {
      const prefix = parts.slice(0, binIdx).join("/");
      const candidate = join(
        prefix,
        "lib",
        "node_modules",
        "@mariozechner",
        "pi-coding-agent",
        "node_modules",
        "@mariozechner",
        "pi-ai",
        "dist",
        "models.generated.js"
      );
      if (await pathExists(candidate)) return candidate;
    }
    const pkgDir = join(realPiPath, "..", "..");
    const candidate2 = join(pkgDir, "node_modules", "@mariozechner", "pi-ai", "dist", "models.generated.js");
    if (await pathExists(candidate2)) return candidate2;
  } catch {
    /* skip */
  }

  const home = homedir();
  const candidates = [
    join(home, ".npm-global", "lib", "node_modules", "@mariozechner", "pi-coding-agent", "node_modules", "@mariozechner", "pi-ai", "dist", "models.generated.js"),
    "/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/models.generated.js",
    "/usr/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/models.generated.js",
  ];
  for (const c of candidates) {
    if (await pathExists(c)) return c;
  }
  return "";
}

/**
 * Build the full model catalog:
 * 1. custom providers/models from models.json
 * 2. builtin models from pi-ai models.generated.js (only for authed providers)
 * 3. `pi --list-models` CLI output
 *
 * `cliAvailable` reports whether the CLI call succeeded; scope mutation
 * handlers use it as write protection against building an allowlist from a
 * partial catalog.
 */
export async function buildModelCatalog(agentDir?: string): Promise<ModelCatalog> {
  const agentDirectory = agentDir ?? join(homedir(), ".pi", "agent");
  const modelsJsonPath = join(agentDirectory, "models.json");
  const settingsPath = join(agentDirectory, "settings.json");
  const authPath = join(agentDirectory, "auth.json");

  const models: CatalogModel[] = [];
  const providers: Record<string, CatalogProvider> = {};

  // 1. auth.json
  let authData: Record<string, { type: string; [key: string]: unknown }> = {};
  if (await pathExists(authPath)) {
    try {
      authData = JSON.parse(await readFile(authPath, "utf-8"));
    } catch {
      /* skip */
    }
  }

  // 2. custom providers from models.json
  if (await pathExists(modelsJsonPath)) {
    try {
      const modelsJson = JSON.parse(await readFile(modelsJsonPath, "utf-8")) as { providers?: Record<string, unknown> };
      const customProviders = modelsJson.providers || {};

      for (const [providerName, rawConfig] of Object.entries(customProviders)) {
        const cfg = rawConfig as {
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
            cost?: ModelCost;
          }>;
        };

        const hasApiKey = typeof cfg.apiKey === "string" && cfg.apiKey.length > 0;
        const hasOAuth = !!authData[providerName];
        const hasAuth = hasApiKey || hasOAuth;

        providers[providerName] = {
          name: providerName,
          baseUrl: cfg.baseUrl || "",
          api: cfg.api || "unknown",
          hasAuth,
          authType: hasOAuth ? "oauth" : hasApiKey ? "api_key" : "none",
          modelCount: 0,
          source: "custom",
          hasApiKey,
        };

        if (cfg.models) {
          for (const model of cfg.models) {
            const entry: CatalogModel = {
              id: model.id,
              name: model.name || model.id,
              provider: providerName,
              contextWindow: model.contextWindow || 0,
              maxTokens: model.maxTokens || 0,
              reasoning: model.reasoning || false,
              images: model.input?.includes("image") || false,
              cost: model.cost,
              source: "custom",
            };
            models.push(entry);
          }
        }
      }
    } catch {
      /* skip */
    }
  }

  // 3. builtin models from pi-ai (authed providers only)
  const builtInModelsPath = await findBuiltInModelsPath();
  if (builtInModelsPath && (await pathExists(builtInModelsPath))) {
    try {
      const content = await readFile(builtInModelsPath, "utf-8");
      const modelRegex = /id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*api:\s*"([^"]+)",\s*provider:\s*"([^"]+)",\s*baseUrl:\s*"([^"]*)"[^}]*?reasoning:\s*(true|false)[^}]*?input:\s*\[([^\]]*)\][^}]*?cost:\s*\{[^}]*?input:\s*([\d.]+)[^}]*?output:\s*([\d.]+)[^}]*?cacheRead:\s*([\d.]+)[^}]*?cacheWrite:\s*([\d.]+)[^}]*?\}[^}]*?contextWindow:\s*(\d+)[^}]*?maxTokens:\s*(\d+)/g;

      let match: RegExpExecArray | null;
      while ((match = modelRegex.exec(content)) !== null) {
        const [, id, name, , provider, , reasoning, input, costIn, costOut, cacheRead, cacheWrite, contextWindow, maxTokens] = match;

        const isAuthenticated =
          !!authData[provider] || !!authData[`${provider}-gemini-cli`] || !!providers[provider];
        if (!isAuthenticated) continue;

        if (models.find((m) => m.provider === provider && m.id === id)) continue;

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
    } catch {
      /* skip */
    }
  }

  // 4. pi --list-models (authoritative "actually available" set)
  let cliAvailable = false;
  const cliModelKeys = new Set<string>();
  try {
    const output = await new Promise<string>((resolve, reject) => {
      exec("pi --list-models 2>&1", { timeout: 10000 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });

    const parsed = parseListModelsOutput(output);
    if (!parsed.ok) {
      // No header / non-table output: do not pretend the read succeeded.
      throw new Error("unrecognized pi --list-models output");
    }
    cliAvailable = true;

    for (const row of parsed.rows) {
      const existing = models.find((m) => m.provider === row.provider && m.id === row.id);
      if (existing) {
        cliModelKeys.add(modelKey(existing));
        continue;
      }
      if (!providers[row.provider]) {
        providers[row.provider] = {
          name: row.provider,
          baseUrl: "",
          api: "unknown",
          hasAuth: true,
          authType: "api_key",
          modelCount: 0,
          source: "cli",
        };
      }
      const entry: CatalogModel = {
        id: row.id,
        name: row.id,
        provider: row.provider,
        contextWindow: row.contextWindow,
        maxTokens: row.maxTokens,
        reasoning: row.reasoning,
        images: row.images,
        source: "cli",
      };
      models.push(entry);
      cliModelKeys.add(modelKey(entry));
    }
  } catch {
    /* CLI failed or output unrecognized: cliAvailable stays false */
  }

  for (const provider of Object.keys(providers)) {
    providers[provider].modelCount = models.filter((m) => m.provider === provider).length;
  }

  // settings (lenient: defaults only, scope handling is done separately)
  let defaultProvider = "";
  let defaultModel = "";
  if (await pathExists(settingsPath)) {
    try {
      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      defaultProvider = settings.defaultProvider || "";
      defaultModel = settings.defaultModel || "";
    } catch {
      /* skip */
    }
  }

  const authProviders = Object.entries(authData).map(([id, val]) => ({
    id,
    type: val.type as string,
  }));

  return {
    models,
    providers,
    authProviders,
    settings: { defaultProvider, defaultModel },
    cliAvailable,
    cliModelKeys,
  };
}

/** Canonical keys of models the pi CLI can actually use right now. */
export function usableModelKeys(catalog: ModelCatalog): Set<string> {
  // Only trust the CLI list: an apiKey field in models.json does not guarantee
  // the model is actually usable (auth may be missing/invalid).
  return new Set(catalog.cliModelKeys);
}

// ---------------------------------------------------------------------------
// `pi --list-models` output parsing
// ---------------------------------------------------------------------------

/** Strip ANSI escape sequences (colors, cursor moves, OSC sequences). */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "");
}

export interface CliModelRow {
  provider: string;
  id: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  images: boolean;
}

const CLI_ROW = /^(\S+)\s+(.+?)\s+(\d[\d,.]*[KMG]?)\s+(\d[\d,.]*[KMG]?)\s+(yes|no)\s+(yes|no)$/i;

/**
 * Parse `pi --list-models` output.
 *
 * Model ids may contain spaces (e.g. "Codex API/gpt-6-astra"), so rows are
 * parsed from the right: the last four columns are fixed
 * (context / maxOut / thinking / images), the first column is the provider,
 * and everything in between is the model id (inner spaces preserved).
 * Rows whose trailing columns are not a valid size + yes/no pair (e.g. stray
 * stderr warnings) are skipped. A header row is required; header present but
 * zero rows still counts as a successful read.
 */
export function parseListModelsOutput(raw: string): { ok: boolean; rows: CliModelRow[] } {
  const lines = stripAnsi(raw)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const headerIdx = lines.findIndex((l) => /^provider\s+model\s+context\s+max-?out\s+thinking\s+images$/i.test(l));
  if (headerIdx === -1) return { ok: false, rows: [] };

  const rows: CliModelRow[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const match = CLI_ROW.exec(line);
    if (!match) continue;
    const [, provider, id, context, maxOut, thinking, images] = match;
    rows.push({
      provider,
      id,
      contextWindow: parseSize(context),
      maxTokens: parseSize(maxOut),
      reasoning: thinking.toLowerCase() === "yes",
      images: images.toLowerCase() === "yes",
    });
  }
  return { ok: true, rows };
}
