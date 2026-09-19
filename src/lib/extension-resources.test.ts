import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  scanPackage,
  scanNpmNodeModules,
  scanExtensionsDir,
  scanSkills,
  isPiPackage,
  type Warnings,
  type ResourceItem,
} from "./extension-resources";

let root: string;
const warnings: Warnings = [];

async function makeFile(path: string, content = "") {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
}

async function makeSymlink(target: string, link: string) {
  try {
    await symlink(target, link, "junction");
  } catch {
    await symlink(target, link, process.platform === "win32" ? "file" : "dir");
  }
}

beforeEach(async () => {
  warnings.length = 0;
  root = await mkdtemp(join(tmpdir(), "pi-res-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("isPiPackage", () => {
  it("detects pi manifest", () => {
    expect(isPiPackage({ pi: { extensions: ["./index.ts"] } })).toBe(true);
  });
  it("detects pi-package keyword", () => {
    expect(isPiPackage({ keywords: ["pi-package", "x"] })).toBe(true);
  });
  it("rejects plain packages", () => {
    expect(isPiPackage({ name: "zod" })).toBe(false);
    expect(isPiPackage(null)).toBe(false);
  });
});

describe("scanPackage extension entries", () => {
  it("counts a .ts file entry as one extension", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-file-ts",
      pi: { extensions: ["./index.ts"] },
    }));
    await makeFile(join(root, "index.ts"), "export default () => {}");

    const items = await scanPackage(root, "package", warnings);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "extension",
      name: "index",
      scope: "package",
      packageName: "pkg-file-ts",
    });
    expect(items[0].path).toBe(join(root, "index.ts"));
  });

  it("counts a .js file entry as one extension (dist build)", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-dist-js",
      pi: { extensions: ["./dist/index.js"] },
    }));
    await makeFile(join(root, join("dist", "index.js")), "export default 1");
    await makeFile(join(root, join("dist", "other.js")), "x");

    const items = await scanPackage(root, "package", warnings);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("index");
    expect(items[0].path).toBe(join(root, "dist", "index.js"));
  });

  it("counts a non-.ts/.js file entry as zero with a warning", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-weird",
      pi: { extensions: ["./main.mjs"] },
    }));
    await makeFile(join(root, "main.mjs"));

    const items = await scanPackage(root, "package", warnings);
    expect(items).toHaveLength(0);
    expect(warnings.some((w) => w.includes("main.mjs"))).toBe(true);
  });

  it("counts a directory entry with index.ts as ONE extension", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "@scope/pkg-subdir",
      pi: { extensions: ["./extensions/subagent"] },
    }));
    const sub = join(root, "extensions", "subagent");
    await makeFile(join(sub, "index.ts"));
    await makeFile(join(sub, "tool.ts"));
    await makeFile(join(sub, "panel.ts"));

    const items = await scanPackage(root, "package", warnings);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("index");
    expect(items[0].path).toBe(join(sub, "index.ts"));
  });

  it("scans a directory entry WITHOUT index as a conventional container (2 files => 2)", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-container",
      pi: { extensions: ["./extensions"] },
    }));
    const ext = join(root, "extensions");
    await makeFile(join(ext, "alpha.ts"));
    await makeFile(join(ext, "beta.js"));
    await makeFile(join(ext, "notes.md"));

    const items = await scanPackage(root, "package", warnings);
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  it("returns zero for an empty directory entry (no invented resource)", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-empty",
      pi: { extensions: ["./extensions"] },
    }));
    await mkdir(join(root, "extensions"), { recursive: true });

    const items = await scanPackage(root, "package", warnings);
    expect(items).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("inner package.json pi.extensions takes priority over directory contents", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-inner",
      pi: { extensions: ["./exts"] },
    }));
    const exts = join(root, "exts");
    await makeFile(join(exts, "package.json"), JSON.stringify({
      name: "inner",
      pi: { extensions: ["./only.ts"] },
    }));
    await makeFile(join(exts, "only.ts"));
    await makeFile(join(exts, "ignored.ts"));

    const items = await scanPackage(root, "package", warnings);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("only");
  });

  it("warns when a manifest entry is missing", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-missing",
      pi: { extensions: ["./src/ghost.ts"] },
    }));

    const items = await scanPackage(root, "package", warnings);
    expect(items).toHaveLength(0);
    expect(warnings.some((w) => w.includes("ghost.ts"))).toBe(true);
  });

  it("skips glob and ! entries with an unsupported warning", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-glob",
      pi: { extensions: ["extensions/*.ts", "!extensions/legacy.ts", "plain.ts"] },
    }));
    await makeFile(join(root, "extensions", "a.ts"));
    await makeFile(join(root, "extensions", "legacy.ts"));
    await makeFile(join(root, "plain.ts"));

    const items = await scanPackage(root, "package", warnings);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("plain");
    expect(warnings.filter((w) => w.includes("unsupported"))).toHaveLength(2);
  });

  it("dedupes duplicate manifest entries", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-dup",
      pi: { extensions: ["./index.ts", "./index.ts"] },
    }));
    await makeFile(join(root, "index.ts"));

    const items = await scanPackage(root, "package", warnings);
    expect(items).toHaveLength(1);
  });

  it("does not hang on a manifest cycle (subdir manifest points at parent)", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-cycle",
      pi: { extensions: ["./extensions"] },
    }));
    const ext = join(root, "extensions");
    await makeFile(join(ext, "one.ts"));
    await makeFile(join(ext, "loop", "package.json"), JSON.stringify({
      name: "loop",
      pi: { extensions: [".."] },
    }));

    const items = await Promise.race<ResourceItem[]>([
      scanPackage(root, "package", warnings),
      new Promise<ResourceItem[]>((_, rej) => setTimeout(() => rej(new Error("hang")), 5000)),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("one");
  });

  it("does not hang on a symlink cycle", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-symcycle",
      pi: { extensions: ["./extensions"] },
    }));
    const ext = join(root, "extensions");
    await makeFile(join(ext, "a.ts"));
    await makeSymlink(ext, join(ext, "self"));

    const items = await Promise.race<ResourceItem[]>([
      scanPackage(root, "package", warnings),
      new Promise<ResourceItem[]>((_, rej) => setTimeout(() => rej(new Error("hang")), 5000)),
    ]);
    expect(items).toHaveLength(1);
  });
});

describe("scanPackage extensions: [] vs absent", () => {
  it("keeps conventional resources for packages without package.json", async () => {
    await makeFile(join(root, "extensions", "legacy.ts"));
    const items = await scanPackage(root, "package", warnings);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("legacy");
  });

  it("explicit [] returns zero and does NOT fall back to extensions/", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-empty-list",
      pi: { extensions: [] },
    }));
    await makeFile(join(root, "extensions", "a.ts"));

    const items = await scanPackage(root, "package", warnings);
    expect(items).toHaveLength(0);
  });

  it("absent extensions key falls back to conventional extensions/", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-conventional",
      keywords: ["pi-package"],
    }));
    await makeFile(join(root, "extensions", "alpha.ts"));
    await makeFile(join(root, "extensions", "beta.js"));
    // subdirectory without index/manifest is not an extension itself
    await makeFile(join(root, "extensions", "helper", "util.ts"));

    const items = await scanPackage(root, "package", warnings);
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  it("picks up a conventional subdirectory that has its own index.ts", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-sub-index",
    }));
    await makeFile(join(root, "extensions", "one.ts"));
    await makeFile(join(root, "extensions", "two", "index.ts"));

    const items = await scanPackage(root, "package", warnings);
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(["index", "one"]);
  });
});

describe("scanPackage skills entries (shallow, original behavior)", () => {
  it("resolves a skills directory entry to SKILL.md subdirectories only", async () => {
    await makeFile(join(root, "package.json"), JSON.stringify({
      name: "pkg-skills",
      pi: { extensions: ["./index.ts"], skills: ["./skills"] },
    }));
    await makeFile(join(root, "index.ts"));
    await makeFile(join(root, "skills", "mcp-scripting", "SKILL.md"), "---\ndescription: scripting skills\n---\n");
    // top-level .md is NOT a skill (shallow behavior)
    await makeFile(join(root, "skills", "standalone.md"));

    const items = await scanPackage(root, "package", warnings);
    const skills = items.filter((i) => i.type === "skill");
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("mcp-scripting");
    expect(skills[0].description).toContain("scripting");
  });
});

describe("scanNpmNodeModules", () => {
  it("scans scoped and unscoped pi packages, skips non-pi packages", async () => {
    const nm = join(root, "node_modules");
    // scoped pi package with file entry
    await makeFile(join(nm, "@scope", "pi-alpha", "package.json"), JSON.stringify({
      name: "@scope/pi-alpha",
      pi: { extensions: ["./index.ts"] },
    }));
    await makeFile(join(nm, "@scope", "pi-alpha", "index.ts"));
    // scoped pi package with directory entry (index container)
    await makeFile(join(nm, "@scope2", "pi-beta", "package.json"), JSON.stringify({
      name: "@scope2/pi-beta",
      pi: { extensions: ["./extensions/beta"] },
    }));
    await makeFile(join(nm, "@scope2", "pi-beta", "extensions", "beta", "index.ts"));
    // unscoped pi package with dist .js entry
    await makeFile(join(nm, "pi-gamma", "package.json"), JSON.stringify({
      name: "pi-gamma",
      pi: { extensions: ["./dist/index.js"] },
    }));
    await makeFile(join(nm, "pi-gamma", "dist", "index.js"));
    // conventional pi package: pi-package keyword, no manifest
    await makeFile(join(nm, "pi-delta", "package.json"), JSON.stringify({
      name: "pi-delta",
      keywords: ["pi-package"],
    }));
    await makeFile(join(nm, "pi-delta", "extensions", "one.ts"));
    await makeFile(join(nm, "pi-delta", "extensions", "two.ts"));
    // non-pi dependency — must be skipped
    await makeFile(join(nm, "zod", "package.json"), JSON.stringify({ name: "zod" }));
    await makeFile(join(nm, "zod", "index.ts"));

    const items = await scanNpmNodeModules(nm, warnings);
    const exts = items.filter((i) => i.type === "extension");
    expect(exts).toHaveLength(5);
    const byPath = Object.fromEntries(exts.map((i) => [i.path, i]));
    expect(byPath[join(nm, "@scope", "pi-alpha", "index.ts")]?.packageName).toBe("@scope/pi-alpha");
    expect(byPath[join(nm, "@scope2", "pi-beta", "extensions", "beta", "index.ts")]?.packageName).toBe("@scope2/pi-beta");
    expect(byPath[join(nm, "pi-gamma", "dist", "index.js")]?.packageName).toBe("pi-gamma");
    expect(byPath[join(nm, "pi-delta", "extensions", "one.ts")]?.packageName).toBe("pi-delta");
    expect(byPath[join(nm, "pi-delta", "extensions", "two.ts")]?.packageName).toBe("pi-delta");
    expect(exts.some((i) => i.packageName === "zod")).toBe(false);
  });

  it("returns [] for a missing directory without warnings", async () => {
    const items = await scanNpmNodeModules(join(root, "nope"), warnings);
    expect(items).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});

describe("scanExtensionsDir (global extensions dir)", () => {
  it("does not treat a directory named index.ts as an entry file", async () => {
    await mkdir(join(root, "index.ts"));
    await makeFile(join(root, "real.ts"));
    const items = await scanExtensionsDir(root, "global", undefined, warnings);
    expect(items.map((item) => item.name)).toEqual(["real"]);
  });

  it("counts top-level .ts and .js files", async () => {
    const dir = join(root, "extensions");
    await makeFile(join(dir, "a.ts"));
    await makeFile(join(dir, "b.js"));
    await makeFile(join(dir, "notes.md"));

    const items = await scanExtensionsDir(dir, "global", undefined, warnings);
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(["a", "b"]);
    expect(items.every((i) => i.scope === "global")).toBe(true);
  });

  it("treats a root index.ts as the single extension", async () => {
    const dir = join(root, "extensions");
    await makeFile(join(dir, "index.ts"));
    await makeFile(join(dir, "extra.ts"));

    const items = await scanExtensionsDir(dir, "global", undefined, warnings);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("index");
  });
});

describe("scanSkills (shallow)", () => {
  it("finds only immediate SKILL.md subdirectories", async () => {
    const dir = join(root, "skills");
    await makeFile(join(dir, "my-skill", "SKILL.md"), "---\ndescription: does things\n---\n");
    await makeFile(join(dir, "standalone.md"), "plain skill");

    const items = await scanSkills(dir, "global", undefined, warnings);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("my-skill");
  });
});
