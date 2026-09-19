import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const state = vi.hoisted(() => ({ home: "", npmGlobal: "" }));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, homedir: () => state.home };
});

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    exec: (
      cmd: string,
      opts: unknown,
      cb: (err: Error | null, stdout?: string) => void
    ) => {
      if (cmd === "npm root -g") {
        return cb(null, `${state.npmGlobal}\n`);
      }
      return actual.exec(cmd, opts as never, cb);
    },
  };
});

// Import after mocks are registered.
const { GET } = await import("./route");
import type { ResourceItem } from "@/lib/extension-resources";

let home: string;
let npmGlobal: string;

async function makeFile(path: string, content = "") {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
}

async function makePiPkg(
  pkgDir: string,
  name: string,
  manifest: Record<string, unknown>
) {
  await makeFile(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, ...manifest })
  );
}

/** Build the shared fixture tree under a fake home + npm global root. */
async function buildFixture() {
  const piNpm = join(home, ".pi", "agent", "npm", "node_modules");
  npmGlobal = join(home, "npm-global-root", "node_modules");

  // Global resources
  await makeFile(join(home, ".pi", "agent", "extensions", "alpha.ts"));
  await makeFile(
    join(home, ".pi", "agent", "skills", "gs1", "SKILL.md"),
    "---\ndescription: global skill\n---\n"
  );
  await makeFile(join(home, ".agents", "skills", "as1", "SKILL.md"), "x");

  // Git package
  const gitPkg = join(home, ".pi", "agent", "git", "pkg-git");
  await makePiPkg(gitPkg, "pkg-git", { pi: { extensions: ["./index.ts"] } });
  await makeFile(join(gitPkg, "index.ts"));

  // Pi npm root
  const pkgA = join(piNpm, "pi-a");
  await makePiPkg(pkgA, "pi-a", { pi: { extensions: ["./index.ts"] } });
  await makeFile(join(pkgA, "index.ts"));

  const pkgB = join(piNpm, "@scope", "pi-b");
  await makePiPkg(pkgB, "@scope/pi-b", {
    pi: { extensions: ["./extensions/beta"] },
  });
  // container without index → two top-level files
  await makeFile(join(pkgB, "extensions", "beta", "x.ts"));
  await makeFile(join(pkgB, "extensions", "beta", "y.js"));

  // non-pi package in pi npm root
  await makePiPkg(join(piNpm, "zod"), "zod", {});
  await makeFile(join(piNpm, "zod", "index.ts"));

  // System npm global root
  const pkgC = join(npmGlobal, "pi-c");
  await makePiPkg(pkgC, "pi-c", { pi: { extensions: ["./dist/index.js"] } });
  await makeFile(join(pkgC, "dist", "index.js"));
}

beforeEach(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  home = await mkdtemp(join(tmpdir(), "ext-route-home-"));
  state.home = home;
  await buildFixture();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});

describe("GET /api/extensions", () => {
  it("integrates both npm roots and returns the bare-array protocol", async () => {
    state.npmGlobal = npmGlobal;
    const res = await GET();
    expect(res.status).toBe(200);
    const items: ResourceItem[] = await res.json();
    expect(Array.isArray(items)).toBe(true);

    const exts = items.filter((i) => i.type === "extension");
    // alpha (global) + pkg-git (git) + pi-a + beta/x + beta/y (pi npm) + pi-c (npm global)
    expect(exts).toHaveLength(6);
    expect(exts.map((e) => e.name).sort()).toEqual(
      ["alpha", "index", "index", "index", "x", "y"].sort()
    );
    expect(exts.filter((e) => e.packageName === "pi-a")).toHaveLength(1);
    expect(exts.filter((e) => e.packageName === "@scope/pi-b")).toHaveLength(2);
    expect(exts.find((e) => e.packageName === "pi-c")).toBeDefined();
    expect(exts.some((e) => e.packageName === "zod")).toBe(false);

    const skills = items.filter((i) => i.type === "skill");
    expect(skills.map((s) => s.name).sort()).toEqual(["as1", "gs1"]);
  });

  it("does not double-scan when the npm global root is the pi npm root", async () => {
    state.npmGlobal = join(home, ".pi", "agent", "npm", "node_modules");
    const res = await GET();
    const items: ResourceItem[] = await res.json();
    const exts = items.filter((i) => i.type === "extension");
    // no pi-c (it only exists in the other root); each package exactly once
    expect(exts).toHaveLength(5);
    expect(exts.filter((e) => e.packageName === "pi-a")).toHaveLength(1);
    expect(exts.filter((e) => e.packageName === "@scope/pi-b")).toHaveLength(2);
    expect(exts.find((e) => e.packageName === "pi-c")).toBeUndefined();
  });

  it("dedupes items by type + case-insensitive path (Windows)", async () => {
    if (process.platform !== "win32") return; // case-sensitive fs: entry would not resolve
    const pkgA = join(home, ".pi", "agent", "npm", "node_modules", "pi-a");
    await writeFile(
      join(pkgA, "package.json"),
      JSON.stringify({ name: "pi-a", pi: { extensions: ["./index.ts", "./INDEX.TS"] } })
    );
    const res = await GET();
    const items: ResourceItem[] = await res.json();
    expect(items.filter((i) => i.packageName === "pi-a")).toHaveLength(1);
  });
});
