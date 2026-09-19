import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { mkdir, readFile, writeFile, rm } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import {
  buildModelCatalog,
  readSettingsStrict,
  writeSettingsAtomic,
  SettingsScopeError,
  type ModelCatalog,
  type CatalogProvider,
} from "@/lib/model-scope";
import { PUT, GET, DELETE } from "./route";

// Mock the home before route import so no production test-only export or
// real user configuration is needed, including for the file-backed CRUD tests.
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const { mkdtemp } = await import("fs/promises");
  const { join } = await import("path");
  const home = await mkdtemp(join(actual.tmpdir(), "models-route-home-"));
  return { ...actual, homedir: () => home };
});

afterAll(async () => {
  await rm(homedir(), { recursive: true, force: true });
});

vi.mock("@/lib/model-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/model-scope")>();
  return {
    ...actual,
    buildModelCatalog: vi.fn(),
    readSettingsStrict: vi.fn(),
    writeSettingsAtomic: vi.fn(),
  };
});

type ModelEntry = {
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  images: boolean;
  source: "custom" | "builtin" | "cli";
};

function makeCatalog(overrides: Partial<ModelCatalog> = {}) {
  const models: ModelEntry[] = [
    {
      provider: "openai-codex",
      id: "gpt-5.5",
      name: "gpt-5.5",
      contextWindow: 200000,
      maxTokens: 32768,
      reasoning: true,
      images: true,
      source: "cli",
    },
    {
      provider: "openai-codex",
      id: "gpt-5.4",
      name: "gpt-5.4",
      contextWindow: 200000,
      maxTokens: 32768,
      reasoning: true,
      images: true,
      source: "cli",
    },
    {
      provider: "ccr",
      id: "local/Qwen3.8-27B",
      name: "local/Qwen3.8-27B",
      contextWindow: 262144,
      maxTokens: 16384,
      reasoning: true,
      images: false,
      source: "custom",
    },
  ];
  const keys = models.map((m) => `${m.provider}/${m.id}`);
  const providers: Record<string, CatalogProvider> = {
    "openai-codex": {
      name: "openai-codex",
      baseUrl: "",
      api: "unknown",
      hasAuth: true,
      authType: "api_key",
      modelCount: 2,
      source: "cli",
    },
    ccr: {
      name: "ccr",
      baseUrl: "",
      api: "openai",
      hasAuth: true,
      authType: "api_key",
      modelCount: 1,
      source: "custom",
    },
  };
  return {
    models,
    providers,
    authProviders: [],
    settings: { defaultProvider: "ccr", defaultModel: "local/Qwen3.8-27B" },
    cliAvailable: true,
    cliModelKeys: new Set(keys),
    ...overrides,
  };
}

function putRequest(body: unknown, host = "localhost:33124"): NextRequest {
  return new NextRequest(`http://${host}/api/models`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Host: host },
    body: JSON.stringify(body),
  });
}

type ModelRow = { provider: string; id: string; inScope: boolean; available: boolean };
type ResponsePayload = {
  catalogOk: boolean;
  scope: { active: boolean; patterns: string[]; fallback: boolean; readError?: string };
  models: ModelRow[];
  success?: boolean;
};

// mutable settings state shared between readSettingsStrict and the "written" value
let settingsState: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  settingsState = {};
  vi.mocked(buildModelCatalog).mockResolvedValue(makeCatalog());
  vi.mocked(readSettingsStrict).mockImplementation(async () => ({ ...settingsState }));
  vi.mocked(writeSettingsAtomic).mockImplementation(async (_path, settings) => {
    settingsState = settings;
  });
});
describe("GET /api/models", () => {
  it("flags each model's in-scope state and exposes scope metadata", async () => {
    settingsState = { enabledModels: ["openai-codex/gpt-5.5"] };
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as ResponsePayload;
    expect(data.catalogOk).toBe(true);
    expect(data.scope).toEqual({ active: true, patterns: ["openai-codex/gpt-5.5"], fallback: false });
    const byKey = Object.fromEntries(data.models.map((m) => [`${m.provider}/${m.id}`, m]));
    expect(byKey["openai-codex/gpt-5.5"].inScope).toBe(true);
    expect(byKey["openai-codex/gpt-5.4"].inScope).toBe(false);
    expect(byKey["ccr/local/Qwen3.8-27B"].inScope).toBe(false);
  });

  it("survives a corrupted settings.json with a readError (everything in scope)", async () => {
    vi.mocked(readSettingsStrict).mockRejectedValue(
      new SettingsScopeError("settings.json 不是有效的 JSON，已拒绝覆盖该文件")
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as ResponsePayload;
    expect(data.scope.readError).toBeTruthy();
    expect(data.scope.active).toBe(false);
    expect(data.scope.fallback).toBe(false);
    expect(data.models.every((m) => m.inScope)).toBe(true);
  });

  it("reports fallback when patterns exist but match no available model", async () => {
    settingsState = { enabledModels: ["ghost/**"] };
    const res = await GET();
    const data = (await res.json()) as ResponsePayload;
    expect(data.scope.fallback).toBe(true);
    expect(data.models.every((m) => m.inScope)).toBe(true);
  });

  it("marks models missing from the CLI catalog as unavailable", async () => {
    const keys = new Set(["openai-codex/gpt-5.5"]);
    vi.mocked(buildModelCatalog).mockResolvedValue(makeCatalog({ cliModelKeys: keys }));
    const res = await GET();
    const data = (await res.json()) as ResponsePayload;
    const byKey = Object.fromEntries(data.models.map((m) => [`${m.provider}/${m.id}`, m]));
    expect(byKey["openai-codex/gpt-5.5"].available).toBe(true);
    expect(byKey["ccr/local/Qwen3.8-27B"].available).toBe(false);
  });
});

describe("PUT action=set-model-scope", () => {
  it("rejects non-local hosts before touching settings", async () => {
    const res = await PUT(putRequest({ action: "set-model-scope", provider: "ccr", modelId: "local/Qwen3.8-27B", inScope: false }, "evil.example.com"));
    expect(res.status).toBe(403);
    expect(writeSettingsAtomic).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads", async () => {
    for (const body of [
      { action: "set-model-scope", provider: "ccr", modelId: "local/Qwen3.8-27B" },
      { action: "set-model-scope", modelId: "local/Qwen3.8-27B", inScope: false },
      { action: "set-model-scope", provider: "ccr", inScope: false },
      { action: "set-model-scope", provider: "ccr", modelId: "local/Qwen3.8-27B", inScope: "yes" },
    ]) {
      const res = await PUT(putRequest(body));
      expect(res.status).toBe(400);
    }
    expect(writeSettingsAtomic).not.toHaveBeenCalled();
  });

  it("refuses to change the scope when the CLI catalog fetch failed (no partial-catalog writes)", async () => {
    vi.mocked(buildModelCatalog).mockResolvedValue(makeCatalog({ cliAvailable: false }));
    const res = await PUT(
      putRequest({ action: "set-model-scope", provider: "ccr", modelId: "local/Qwen3.8-27B", inScope: false })
    );
    expect(res.status).toBe(503);
    expect(writeSettingsAtomic).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown models without writing", async () => {
    const res = await PUT(
      putRequest({ action: "set-model-scope", provider: "ccr", modelId: "nope", inScope: true })
    );
    expect(res.status).toBe(404);
    expect(writeSettingsAtomic).not.toHaveBeenCalled();
  });

  it("exclude without scope writes an explicit allowlist and preserves unrelated settings", async () => {
    settingsState = { defaultProvider: "ccr", defaultModel: "local/Qwen3.8-27B" };
    const res = await PUT(
      putRequest({ action: "set-model-scope", provider: "ccr", modelId: "local/Qwen3.8-27B", inScope: false })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(writeSettingsAtomic).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeSettingsAtomic).mock.calls[0][1];
    expect(written.enabledModels).toEqual(["openai-codex/gpt-5.5", "openai-codex/gpt-5.4"]);
    expect(written.defaultProvider).toBe("ccr");
    expect(written.defaultModel).toBe("local/Qwen3.8-27B");
  });

  it("include appends the exact provider/id", async () => {
    settingsState = { enabledModels: ["openai-codex/gpt-5.5"] };
    const res = await PUT(
      putRequest({ action: "set-model-scope", provider: "ccr", modelId: "local/Qwen3.8-27B", inScope: true })
    );
    expect(res.status).toBe(200);
    const written = vi.mocked(writeSettingsAtomic).mock.calls[0][1];
    expect(written.enabledModels).toEqual(["openai-codex/gpt-5.5", "ccr/local/Qwen3.8-27B"]);
  });

  it("include is a no-op when already in scope (no write)", async () => {
    settingsState = { enabledModels: ["openai-codex/**"] };
    const res = await PUT(
      putRequest({ action: "set-model-scope", provider: "openai-codex", modelId: "gpt-5.4", inScope: true })
    );
    expect(res.status).toBe(200);
    expect(writeSettingsAtomic).not.toHaveBeenCalled();
  });

  it("rejects excluding the last actually usable model (custom models without CLI availability cannot bypass)", async () => {
    // Only the target is usable; the extra custom model is not in the CLI list
    const catalog = makeCatalog({
      cliModelKeys: new Set(["ccr/local/Qwen3.8-27B"]),
    });
    catalog.models.push({
      provider: "mycustom",
      id: "some-model",
      name: "some-model",
      contextWindow: 0,
      maxTokens: 0,
      reasoning: false,
      images: false,
      source: "custom",
    });
    vi.mocked(buildModelCatalog).mockResolvedValue(catalog);
    settingsState = {};
    const res = await PUT(
      putRequest({ action: "set-model-scope", provider: "ccr", modelId: "local/Qwen3.8-27B", inScope: false })
    );
    expect(res.status).toBe(400);
    expect(writeSettingsAtomic).not.toHaveBeenCalled();
  });

  it("rejects setting scope for a model that is not actually usable", async () => {
    const catalog = makeCatalog({
      cliModelKeys: new Set(["openai-codex/gpt-5.5", "openai-codex/gpt-5.4"]),
    });
    vi.mocked(buildModelCatalog).mockResolvedValue(catalog);
    const res = await PUT(
      putRequest({ action: "set-model-scope", provider: "ccr", modelId: "local/Qwen3.8-27B", inScope: false })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/认证/);
    expect(writeSettingsAtomic).not.toHaveBeenCalled();
  });

  it("rejects when settings.json is corrupted and surfaces the readable message", async () => {
    vi.mocked(readSettingsStrict).mockRejectedValue(
      new SettingsScopeError("settings.json 不是有效的 JSON，已拒绝覆盖该文件")
    );
    const res = await PUT(
      putRequest({ action: "set-model-scope", provider: "ccr", modelId: "local/Qwen3.8-27B", inScope: false })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("settings.json 不是有效的 JSON，已拒绝覆盖该文件");
    expect(writeSettingsAtomic).not.toHaveBeenCalled();
  });

  it("returns 400 (not 500) for an invalid JSON body or a null body", async () => {
    const badJson = new NextRequest("http://localhost:33124/api/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Host: "localhost:33124" },
      body: "{ not json",
    });
    expect((await PUT(badJson)).status).toBe(400);

    const nullBody = new NextRequest("http://localhost:33124/api/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Host: "localhost:33124" },
      body: JSON.stringify(null),
    });
    expect((await PUT(nullBody)).status).toBe(400);

    const arrayBody = new NextRequest("http://localhost:33124/api/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Host: "localhost:33124" },
      body: JSON.stringify([1, 2]),
    });
    expect((await PUT(arrayBody)).status).toBe(400);
    expect(writeSettingsAtomic).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/models (regression)", () => {
  const dir = join(homedir(), ".pi", "agent");

  beforeEach(async () => {
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function deleteRequest(provider: string): NextRequest {
    return new NextRequest(`http://localhost:33124/api/models?provider=${provider}`, {
      method: "DELETE",
      headers: { Host: "localhost:33124" },
    });
  }

  it("deleting an entire provider persists the change to models.json", async () => {
    const file = join(dir, "models.json");
    await writeFile(
      file,
      JSON.stringify(
        {
          other: { keep: true },
          providers: {
            a: { baseUrl: "https://a", api: "openai", models: [{ id: "m1" }] },
            b: { baseUrl: "https://b", api: "openai", models: [] },
          },
        },
        null,
        2
      ),
      "utf-8"
    );
    const res = await DELETE(deleteRequest("a"));
    expect(res.status).toBe(200);

    const written = JSON.parse(await readFile(file, "utf-8"));
    expect(written.providers.a).toBeUndefined();
    expect(written.providers.b).toBeDefined();
    expect(written.other).toEqual({ keep: true });
  });

  it("deleting a single model persists the change to models.json", async () => {
    const file = join(dir, "models.json");
    await writeFile(
      file,
      JSON.stringify({ providers: { a: { baseUrl: "https://a", api: "openai", models: [{ id: "m1" }, { id: "m2" }] } } }),
      "utf-8"
    );
    const res = await DELETE(deleteRequest("a"));
    // provider without modelId deletes the whole provider
    expect(res.status).toBe(200);
    let written = JSON.parse(await readFile(file, "utf-8"));
    expect(written.providers).toEqual({});

    await writeFile(file, JSON.stringify({ providers: { a: { baseUrl: "https://a", api: "openai", models: [{ id: "m1" }, { id: "m2" }] } } }), "utf-8");
    const modelReq = new NextRequest("http://localhost:33124/api/models?provider=a&modelId=m1", {
      method: "DELETE",
      headers: { Host: "localhost:33124" },
    });
    const res2 = await DELETE(modelReq);
    expect(res2.status).toBe(200);
    written = JSON.parse(await readFile(file, "utf-8"));
    expect(written.providers.a.models.map((m: { id: string }) => m.id)).toEqual(["m2"]);
  });
});
describe("PUT action=reset-model-scope", () => {
  it("removes enabledModels, preserving the rest of the settings", async () => {
    settingsState = { defaultProvider: "ccr", enabledModels: ["ccr/**"] };
    const res = await PUT(putRequest({ action: "reset-model-scope" }));
    expect(res.status).toBe(200);
    const written = vi.mocked(writeSettingsAtomic).mock.calls[0][1];
    expect(written).toEqual({ defaultProvider: "ccr" });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.scope.active).toBe(false);
  });

  it("is idempotent when no scope is configured (no write)", async () => {
    settingsState = { defaultProvider: "ccr" };
    const res = await PUT(putRequest({ action: "reset-model-scope" }));
    expect(res.status).toBe(200);
    expect(writeSettingsAtomic).not.toHaveBeenCalled();
  });

  it("does not depend on the CLI catalog", async () => {
    vi.mocked(buildModelCatalog).mockResolvedValue(makeCatalog({ cliAvailable: false }));
    settingsState = { enabledModels: ["ccr/**"] };
    const res = await PUT(putRequest({ action: "reset-model-scope" }));
    expect(res.status).toBe(200);
    expect(writeSettingsAtomic).toHaveBeenCalledTimes(1);
  });
});
