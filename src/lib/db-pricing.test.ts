import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadModelsJsonCosts } from "./db";

function writeModelsJson(providers: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "pricing-test-"));
  const file = join(dir, "models.json");
  writeFileSync(file, JSON.stringify({ providers }), "utf-8");
  return file;
}

function cleanup(file: string) {
  rmSync(join(file, ".."), { recursive: true, force: true });
}

describe("loadModelsJsonCosts", () => {
  it("includes explicit all-zero cost (self-hosted / free model)", () => {
    const file = writeModelsJson({
      local: {
        baseUrl: "http://127.0.0.1:8003/v1",
        api: "openai-completions",
        models: [
          { id: "Qwen3.8-27B", name: "Qwen3.8 27B", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
        ],
      },
    });
    try {
      const costs = loadModelsJsonCosts(file);
      expect(costs).toHaveLength(1);
      expect(costs[0]).toMatchObject({
        model: "Qwen3.8-27B",
        inputPrice: 0,
        outputPrice: 0,
        cacheReadPrice: 0,
        cacheWritePrice: 0,
        source: "models.json",
      });
    } finally {
      cleanup(file);
    }
  });

  it("includes non-zero cost", () => {
    const file = writeModelsJson({
      p: {
        models: [{ id: "m1", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } }],
      },
    });
    try {
      const costs = loadModelsJsonCosts(file);
      expect(costs).toHaveLength(1);
      expect(costs[0]).toMatchObject({ model: "m1", inputPrice: 1, outputPrice: 2 });
    } finally {
      cleanup(file);
    }
  });

  it("skips models without a cost object or with a non-numeric cost", () => {
    const file = writeModelsJson({
      p: {
        models: [
          { id: "no-cost" },
          { id: "empty-cost", cost: {} },
          { id: "null-cost", cost: null },
        ],
      },
    });
    try {
      expect(loadModelsJsonCosts(file)).toEqual([]);
    } finally {
      cleanup(file);
    }
  });

  it("returns [] when the file does not exist", () => {
    expect(loadModelsJsonCosts(join(tmpdir(), "does-not-exist-models.json"))).toEqual([]);
  });
});
