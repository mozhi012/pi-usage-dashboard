import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm, readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  computeScopedPatterns,
  isGlobPattern,
  modelInScope,
  modelKey,
  parseListModelsOutput,
  patternCoversModel,
  readSettingsStrict,
  resolvePattern,
  resolveScopedKeys,
  scopeLeavesUsableModel,
  splitThinkingSuffix,
  stripAnsi,
  withSettingsLock,
  writeSettingsAtomic,
  SettingsScopeError,
} from "./model-scope";
import type { ScopeModel } from "./model-scope";

function model(provider: string, id: string, name?: string): ScopeModel {
  return { provider, id, name };
}

const catalog: ScopeModel[] = [
  model("openai-codex", "gpt-5.5"),
  model("openai-codex", "gpt-5.4"),
  model("ccr", "local/Qwen3.8-27B"),
  model("gemini-direct", "gemini-3.8-flash"),
];

const allUsable = new Set(catalog.map(modelKey));

describe("pattern basics", () => {
  it("detects glob patterns only on * ? [", () => {
    expect(isGlobPattern("ccr/**")).toBe(true);
    expect(isGlobPattern("openai-codex/gpt-*")).toBe(true);
    expect(isGlobPattern("a?b")).toBe(true);
    expect(isGlobPattern("a[b]")).toBe(true);
    expect(isGlobPattern("ccr/local/Qwen3.8-27B")).toBe(false);
  });

  it("keeps a valid thinking suffix instead of treating it as part of the id", () => {
    expect(splitThinkingSuffix("openai-codex/**:medium")).toEqual({
      pattern: "openai-codex/**",
      level: "medium",
    });
    // ids with colons that are not a valid level stay untouched
    expect(splitThinkingSuffix("openrouter/anthropic/claude:exacto")).toEqual({
      pattern: "openrouter/anthropic/claude:exacto",
    });
  });
});

describe("matching semantics (mirroring pi model-resolver)", () => {
  it("matches slash-containing model ids by canonical provider/id", () => {
    const slashCatalog: ScopeModel[] = [
      model("zai", "glm-5.1"),
      model("vercel-ai-gateway", "zai/glm-5.1"),
    ];
    // canonical reference of the zai model only
    expect(patternCoversModel("zai/glm-5.1", slashCatalog[0], slashCatalog)).toBe(true);
    expect(patternCoversModel("zai/glm-5.1", slashCatalog[1], slashCatalog)).toBe(false);
  });

  it("bare ids shared by multiple providers never match more than one model", () => {
    const dupCatalog: ScopeModel[] = [
      model("moonshotai", "kimi-k2.6"),
      model("huggingface", "kimi-k2.6"),
    ];
    // ambiguous bare id -> substring fallback picks one model (stable, highest sorting id)
    expect(patternCoversModel("kimi-k2.6", dupCatalog[0], dupCatalog)).toBe(true);
    expect(patternCoversModel("kimi-k2.6", dupCatalog[1], dupCatalog)).toBe(false);
    // canonical references remain unambiguous
    expect(patternCoversModel("huggingface/kimi-k2.6", dupCatalog[1], dupCatalog)).toBe(true);
    expect(patternCoversModel("moonshotai/kimi-k2.6", dupCatalog[1], dupCatalog)).toBe(false);
  });

  it("matches ** globs across slash ids and honors nocase", () => {
    expect(patternCoversModel("openai-codex/**", model("openai-codex", "gpt-5.5"), catalog)).toBe(true);
    expect(patternCoversModel("ccr/**", model("ccr", "local/Qwen3.8-27B"), catalog)).toBe(true);
    expect(patternCoversModel("antigravity/**", model("ccr", "local/Qwen3.8-27B"), catalog)).toBe(false);
    expect(patternCoversModel("OPENAI-CODEX/**", model("openai-codex", "gpt-5.4"), catalog)).toBe(true);
    expect(patternCoversModel("openai-codex/**", model("ccr", "local/Qwen3.8-27B"), catalog)).toBe(false);
  });

  it("prefers non-dated aliases over dated versions in substring fallback", () => {
    const datedCatalog: ScopeModel[] = [
      model("anthropic", "claude-opus-4-8-20250929"),
      model("anthropic", "claude-opus-4-8"),
    ];
    expect(resolveScopedKeys(["opus-4-8"], datedCatalog)).toEqual(
      new Set(["anthropic/claude-opus-4-8"])
    );
  });

  it("recursively strips colon suffixes (id:high:max) to resolve the model", () => {
    const colonCatalog: ScopeModel[] = [model("ccr", "local/Qwen3.8-27B")];
    expect(resolvePattern("local/Qwen3.8-27B:high:max", colonCatalog)).toBe("ccr/local/Qwen3.8-27B");
    expect(resolvePattern("local/Qwen3.8-27B:max", colonCatalog)).toBe("ccr/local/Qwen3.8-27B");
    expect(resolvePattern("local/Qwen3.8-27B", colonCatalog)).toBe("ccr/local/Qwen3.8-27B");
  });
});

describe("modelInScope / resolveScopedKeys", () => {
  it("treats a missing or empty pattern list as all-in-scope", () => {
    for (const patterns of [null, undefined, []]) {
      for (const m of catalog) {
        expect(modelInScope(patterns, m, catalog)).toBe(true);
      }
    }
  });

  it("falls back to all-in-scope when no pattern matches any model (pi behavior)", () => {
    for (const m of catalog) {
      expect(modelInScope(["definitely-not-a-model-*"], m, catalog)).toBe(true);
    }
  });

  it("computes the scoped key set from mixed rules", () => {
    const keys = resolveScopedKeys(
      ["openai-codex/gpt-5.5", "ccr/**", "matches-nothing/**"],
      catalog
    );
    expect(keys).toEqual(
      new Set(["openai-codex/gpt-5.5", "ccr/local/Qwen3.8-27B"])
    );
  });
});

describe("computeScopedPatterns", () => {
  it("include is a no-op when the model is already in scope", () => {
    const result = computeScopedPatterns({
      patterns: ["openai-codex/**"],
      target: { provider: "openai-codex", id: "gpt-5.4" },
      action: "include",
      catalog,
    });
    expect(result.changed).toBe(false);
    expect(result.patterns).toEqual(["openai-codex/**"]);
  });

  it("include appends the exact provider/id without restoring wildcard rules", () => {
    const result = computeScopedPatterns({
      patterns: ["openai-codex/**"],
      target: { provider: "ccr", id: "local/Qwen3.8-27B" },
      action: "include",
      catalog,
    });
    expect(result.changed).toBe(true);
    expect(result.patterns).toEqual(["openai-codex/**", "ccr/local/Qwen3.8-27B"]);
  });

  it("exclude with no scope keeps nothing else and builds an explicit allowlist of the whole catalog minus the target", () => {
    const result = computeScopedPatterns({
      patterns: null,
      target: { provider: "ccr", id: "local/Qwen3.8-27B" },
      action: "exclude",
      catalog,
    });
    expect(result.patterns).toEqual([
      "openai-codex/gpt-5.5",
      "openai-codex/gpt-5.4",
      "gemini-direct/gemini-3.8-flash",
    ]);
  });

  it("exclude with a non-matching scope preserves the original rules and appends the explicit allowlist", () => {
    const result = computeScopedPatterns({
      patterns: ["ghost/**"],
      target: { provider: "ccr", id: "local/Qwen3.8-27B" },
      action: "exclude",
      catalog,
    });
    expect(result.patterns).toEqual([
      "ghost/**",
      "openai-codex/gpt-5.5",
      "openai-codex/gpt-5.4",
      "gemini-direct/gemini-3.8-flash",
    ]);
    expect(result.removedRules).toEqual([]);
  });

  it("exclude expands covering glob rules to the other matches, preserving thinking suffix and order", () => {
    const result = computeScopedPatterns({
      patterns: ["openai-codex/**:medium"],
      target: { provider: "openai-codex", id: "gpt-5.5" },
      action: "exclude",
      catalog,
    });
    expect(result.removedRules).toEqual(["openai-codex/**:medium"]);
    expect(result.patterns).toEqual(["openai-codex/gpt-5.4:medium"]);
  });

  it("exclude drops single-model rules entirely", () => {
    const result = computeScopedPatterns({
      patterns: ["openai-codex/gpt-5.5:high", "ccr/**"],
      target: { provider: "openai-codex", id: "gpt-5.5" },
      action: "exclude",
      catalog,
    });
    expect(result.patterns).toEqual(["ccr/**"]);
  });

  it("keeps unrelated rules (including non-matching ones) verbatim", () => {
    const result = computeScopedPatterns({
      patterns: ["ghost/**", "openai-codex/**", "another-rule"],
      target: { provider: "openai-codex", id: "gpt-5.4" },
      action: "exclude",
      catalog,
    });
    expect(result.patterns).toEqual(["ghost/**", "openai-codex/gpt-5.5", "another-rule"]);
  });

  it("handles every rule that covers the target (overlapping patterns, no duplicates, no ! patterns)", () => {
    const result = computeScopedPatterns({
      patterns: ["openai-codex/**", "openai-codex/gpt-*"],
      target: { provider: "openai-codex", id: "gpt-5.5" },
      action: "exclude",
      catalog,
    });
    expect(result.patterns).toEqual(["openai-codex/gpt-5.4"]);
    expect(result.patterns.every((p) => !p.startsWith("!"))).toBe(true);
  });
});

describe("scopeLeavesUsableModel", () => {
  it("allows excluding one of several usable models", () => {
    expect(
      scopeLeavesUsableModel(["openai-codex/gpt-5.5", "ccr/local/Qwen3.8-27B"], allUsable, catalog)
    ).toBe(true);
  });

  it("rejects leaving zero usable models (unauthenticated custom models do not count)", () => {
    const unusableOnly = scopeLeavesUsableModel(["gemini-direct/gemini-3.8-flash"], allUsable, catalog);
    expect(unusableOnly).toBe(true); // it is in the usable set here
    // only a custom model without auth remains in scope
    const usable = new Set(["openai-codex/gpt-5.5"]);
    expect(scopeLeavesUsableModel(["gemini-direct/gemini-3.8-flash"], usable, catalog)).toBe(false);
  });

  it("rejects an empty resulting list (writing [] would restore all models)", () => {
    expect(scopeLeavesUsableModel([], allUsable, catalog)).toBe(false);
  });
});

describe("parseListModelsOutput", () => {
  const realFormat = [
    "provider            model                        context   maxOut    thinking  images",
    "ccr                 local/Qwen3.8-27B            256K      16K       yes       no",
    "ccr                 Codex API/gpt-6-astra        1M        128K      yes       yes",
    "openai-codex        gpt-5.5                      400K      128K      yes       yes",
  ].join("\n");

  it("parses model ids containing spaces (right-anchored fixed columns)", () => {
    const { ok, rows } = parseListModelsOutput(realFormat);
    expect(ok).toBe(true);
    expect(rows).toEqual([
      { provider: "ccr", id: "local/Qwen3.8-27B", contextWindow: 256000, maxTokens: 16000, reasoning: true, images: false },
      { provider: "ccr", id: "Codex API/gpt-6-astra", contextWindow: 1_000_000, maxTokens: 128000, reasoning: true, images: true },
      { provider: "openai-codex", id: "gpt-5.5", contextWindow: 400000, maxTokens: 128000, reasoning: true, images: true },
    ]);
  });

  it("strips ANSI codes and ignores stray warning lines before/after the table", () => {
    const raw = [
      "\u001b[33mWarning: checking for updates...\u001b[0m",
      "\u001b[1mprovider\u001b[0m  model  context  maxOut  thinking  images",
      "some stderr warning line that is not a table row at all",
      "ccr  gpt-5.5  400K  128K  yes  yes",
      "",
      "note: done in 3ms",
    ].join("\n");
    const { ok, rows } = parseListModelsOutput(raw);
    expect(ok).toBe(true);
    expect(rows).toEqual([
      { provider: "ccr", id: "gpt-5.5", contextWindow: 400000, maxTokens: 128000, reasoning: true, images: true },
    ]);
  });

  it("accepts a header with zero rows as a successful read", () => {
    const { ok, rows } = parseListModelsOutput("provider  model  context  maxOut  thinking  images");
    expect(ok).toBe(true);
    expect(rows).toEqual([]);
  });

  it("requires a header row: non-table output is not a successful read", () => {
    expect(parseListModelsOutput("")).toEqual({ ok: false, rows: [] });
    expect(parseListModelsOutput("Error: no models configured")).toEqual({ ok: false, rows: [] });
    expect(parseListModelsOutput("ccr  gpt-5.5  400K  128K  yes  yes")).toEqual({ ok: false, rows: [] });
  });

  it("rejects rows whose trailing columns are not valid sizes/yes-no", () => {
    const raw = [
      "provider  model  context  maxOut  thinking  images",
      "ccr  gpt-5.5  400K  128K  maybe  yes",
      "ccr  gpt-5.4  400K  128K  yes  yes",
    ].join("\n");
    const { ok, rows } = parseListModelsOutput(raw);
    expect(ok).toBe(true);
    expect(rows.map((r) => r.id)).toEqual(["gpt-5.4"]);
  });

  it("preserves repeated spaces inside ids with the real max-out header", () => {
    const parsed = parseListModelsOutput(
      "provider model context max-out thinking images\nccr  Codex  API/gpt-6-astra  1M  128K  yes  yes"
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0].id).toBe("Codex  API/gpt-6-astra");
    expect(parseListModelsOutput("provider warning: catalog unavailable").ok).toBe(false);
  });

  it("stripAnsi removes CSI and OSC sequences", () => {
    expect(stripAnsi("\u001b[1m\u001b[32mok\u001b[0m done")).toBe("ok done");
    expect(stripAnsi("\u001b]0;title\u0007body")).toBe("body");
  });
});

describe("settings.json access", () => {
  async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "model-scope-"));
    try {
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("returns {} for a missing settings file", async () => {
    await withTempDir(async (dir) => {
      expect(await readSettingsStrict(join(dir, "settings.json"))).toEqual({});
    });
  });

  it("refuses to read (and therefore overwrite) corrupted or malformed settings", async () => {
    await withTempDir(async (dir) => {
      const p = join(dir, "settings.json");
      await writeFile(p, "{ not json", "utf-8");
      await expect(readSettingsStrict(p)).rejects.toThrow(SettingsScopeError);

      await writeFile(p, "[1,2]", "utf-8");
      await expect(readSettingsStrict(p)).rejects.toThrow(SettingsScopeError);

      await writeFile(p, JSON.stringify({ enabledModels: ["ok", 3] }), "utf-8");
      await expect(readSettingsStrict(p)).rejects.toThrow(SettingsScopeError);

      await writeFile(p, JSON.stringify({ defaultProvider: "ccr" }), "utf-8");
      expect(await readSettingsStrict(p)).toEqual({ defaultProvider: "ccr" });
    });
  });

  it("writes atomically and preserves unrelated settings", async () => {
    await withTempDir(async (dir) => {
      const p = join(dir, "settings.json");
      await writeFile(
        p,
        JSON.stringify({ defaultProvider: "ccr", defaultModel: "local/Qwen3.8-27B", theme: "light" }),
        "utf-8"
      );

      const settings = await readSettingsStrict(p);
      settings.enabledModels = ["ccr/**"];
      await writeSettingsAtomic(p, settings);

      const written = JSON.parse(await readFile(p, "utf-8"));
      expect(written).toEqual({
        defaultProvider: "ccr",
        defaultModel: "local/Qwen3.8-27B",
        theme: "light",
        enabledModels: ["ccr/**"],
      });
      // no leftover temp files
      const entries = await readdir(dir);
      expect(entries).toEqual(["settings.json"]);
    });
  });

  it("serializes concurrent read-modify-write cycles", async () => {
    await withTempDir(async (dir) => {
      const p = join(dir, "settings.json");
      const bump = () =>
        withSettingsLock(p, async () => {
          const s = await readSettingsStrict(p);
          s.count = (typeof s.count === "number" ? s.count : 0) + 1;
          await writeSettingsAtomic(p, s);
        });
      await Promise.all([bump(), bump(), bump()]);
      const s = await readSettingsStrict(p);
      expect(s.count).toBe(3);
    });
  });
});
