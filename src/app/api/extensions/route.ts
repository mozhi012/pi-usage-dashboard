/**
 * Extensions, Skills, Prompts & Themes API
 *
 * Scans pi's global directories for installed resources.
 * Supports GET (list) and DELETE (remove).
 *
 * GET /api/extensions
 * DELETE /api/extensions { path, type }
 */
import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile, access, rm, stat } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import { exec } from "child_process";
import { requireMutationAuth } from "@/lib/api-security";
import { resolveContainedPath } from "@/lib/path-security";

interface ResourceItem {
  name: string;
  type: "extension" | "skill" | "prompt" | "theme";
  scope: "global" | "package";
  path: string;
  description?: string;
  packageName?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function scanExtensions(dir: string, scope: "global" | "package", packageName?: string): Promise<ResourceItem[]> {
  const items: ResourceItem[] = [];
  if (!(await exists(dir))) return items;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);

      if (entry.isFile() && entry.name.endsWith(".ts")) {
        items.push({
          name: entry.name.replace(/\.ts$/, ""),
          type: "extension",
          scope,
          path: fullPath,
          packageName,
        });
      } else if (entry.isDirectory()) {
        const indexPath = join(fullPath, "index.ts");
        if (await exists(indexPath)) {
          items.push({
            name: entry.name,
            type: "extension",
            scope,
            path: fullPath,
            packageName,
          });
        }
      }
    }
  } catch {
    // skip
  }
  return items;
}

async function scanSkills(dir: string, scope: "global" | "package", packageName?: string): Promise<ResourceItem[]> {
  const items: ResourceItem[] = [];
  if (!(await exists(dir))) return items;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skillPath = join(dir, entry.name);
      const skillFile = join(skillPath, "SKILL.md");

      if (await exists(skillFile)) {
        let description = "";
        try {
          const content = await readFile(skillFile, "utf-8");
          // Parse YAML frontmatter description
          const match = content.match(/description:\s*["']?(.+?)["']?\s*[\n-]/);
          if (match) description = match[1].trim().slice(0, 120);
        } catch {
          // skip
        }

        items.push({
          name: entry.name,
          type: "skill",
          scope,
          path: skillPath,
          description,
          packageName,
        });
      }
    }
  } catch {
    // skip
  }
  return items;
}

async function scanPrompts(dir: string, scope: "global" | "package", packageName?: string): Promise<ResourceItem[]> {
  const items: ResourceItem[] = [];
  if (!(await exists(dir))) return items;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isFile() && entry.name.endsWith(".md")) {
        items.push({
          name: entry.name.replace(/\.md$/, ""),
          type: "prompt",
          scope,
          path: join(dir, entry.name),
          packageName,
        });
      }
    }
  } catch {
    // skip
  }
  return items;
}

async function scanThemes(dir: string, scope: "global" | "package", packageName?: string): Promise<ResourceItem[]> {
  const items: ResourceItem[] = [];
  if (!(await exists(dir))) return items;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".ts"))) {
        items.push({
          name: entry.name.replace(/\.(json|ts)$/, ""),
          type: "theme",
          scope,
          path: join(dir, entry.name),
          packageName,
        });
      }
    }
  } catch {
    // skip
  }
  return items;
}

async function scanPackages(packagesDir: string): Promise<ResourceItem[]> {
  const items: ResourceItem[] = [];
  if (!(await exists(packagesDir))) return items;

  try {
    const entries = await readdir(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const pkgDir = join(packagesDir, entry.name);
      const pkgJsonPath = join(pkgDir, "package.json");
      const pkgName = entry.name;

      let piConfig: { extensions?: string[]; skills?: string[]; prompts?: string[]; themes?: string[] } = {};

      if (await exists(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
          piConfig = pkgJson.pi || {};
        } catch {
          // skip
        }
      }

      // Scan configured or conventional dirs
      const extDirs = piConfig.extensions || ["./extensions"];
      const skillDirs = piConfig.skills || ["./skills"];
      const promptDirs = piConfig.prompts || ["./prompts"];
      const themeDirs = piConfig.themes || ["./themes"];

      for (const d of extDirs) {
        items.push(...await scanExtensions(join(pkgDir, d), "package", pkgName));
      }
      for (const d of skillDirs) {
        items.push(...await scanSkills(join(pkgDir, d), "package", pkgName));
      }
      for (const d of promptDirs) {
        items.push(...await scanPrompts(join(pkgDir, d), "package", pkgName));
      }
      for (const d of themeDirs) {
        items.push(...await scanThemes(join(pkgDir, d), "package", pkgName));
      }
    }
  } catch {
    // skip
  }
  return items;
}

/**
 * Resolve the npm global node_modules directory dynamically.
 * Uses `npm root -g` to find the correct path regardless of installation method.
 */
async function findNpmGlobalDir(): Promise<string> {
  try {
    const dir = await new Promise<string>((resolve, reject) => {
      exec("npm root -g", { timeout: 5000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    return dir;
  } catch {
    // Fallback to common locations
    const home = homedir();
    const candidates = [
      join(home, ".npm-global", "lib", "node_modules"),
      "/usr/local/lib/node_modules",
      "/usr/lib/node_modules",
    ];
    for (const c of candidates) {
      if (await exists(c)) return c;
    }
    return "";
  }
}

export async function GET() {
  try {
    const home = homedir();
    const piDir = join(home, ".pi", "agent");
    const agentsDir = join(home, ".agents");

    const items: ResourceItem[] = [];

    // Global pi resources
    items.push(...await scanExtensions(join(piDir, "extensions"), "global"));
    items.push(...await scanSkills(join(piDir, "skills"), "global"));
    items.push(...await scanSkills(join(agentsDir, "skills"), "global"));
    items.push(...await scanPrompts(join(piDir, "prompts"), "global"));
    items.push(...await scanThemes(join(piDir, "themes"), "global"));

    // Installed packages (git)
    items.push(...await scanPackages(join(piDir, "git")));

    // Installed packages (npm global) — resolve dynamically
    const npmGlobalDir = await findNpmGlobalDir();
    if (npmGlobalDir && await exists(npmGlobalDir)) {
      try {
        const npmEntries = await readdir(npmGlobalDir, { withFileTypes: true });
        for (const entry of npmEntries) {
          if (!entry.isDirectory()) continue;
          const pkgDir = join(npmGlobalDir, entry.name);

          if (entry.name.startsWith("@")) {
            const scopedEntries = await readdir(pkgDir, { withFileTypes: true });
            for (const scoped of scopedEntries) {
              if (!scoped.isDirectory()) continue;
              const scopedPkgDir = join(pkgDir, scoped.name);
              const pkgJsonPath = join(scopedPkgDir, "package.json");
              if (await exists(pkgJsonPath)) {
                try {
                  const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
                  if (pkgJson.pi || pkgJson.keywords?.includes("pi-package")) {
                    items.push(...await scanPackages(join(scopedPkgDir, "..")));
                  }
                } catch { /* skip */ }
              }
            }
          } else {
            const pkgJsonPath = join(pkgDir, "package.json");
            if (await exists(pkgJsonPath)) {
              try {
                const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
                if (pkgJson.pi || pkgJson.keywords?.includes("pi-package")) {
                  const piConfig = pkgJson.pi || {};
                  const extDirs = piConfig.extensions || ["./extensions"];
                  const skillDirs = piConfig.skills || ["./skills"];
                  const promptDirs = piConfig.prompts || ["./prompts"];
                  const themeDirs = piConfig.themes || ["./themes"];

                  for (const d of extDirs) items.push(...await scanExtensions(join(pkgDir, d), "package", basename(pkgDir)));
                  for (const d of skillDirs) items.push(...await scanSkills(join(pkgDir, d), "package", basename(pkgDir)));
                  for (const d of promptDirs) items.push(...await scanPrompts(join(pkgDir, d), "package", basename(pkgDir)));
                  for (const d of themeDirs) items.push(...await scanThemes(join(pkgDir, d), "package", basename(pkgDir)));
                }
              } catch { /* skip */ }
            }
          }
        }
      } catch { /* skip */ }
    }

    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to scan resources", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { path: targetPath, type } = body;

    if (!targetPath || typeof targetPath !== "string") {
      return NextResponse.json(
        { error: "path is required" },
        { status: 400 }
      );
    }

    // Safety: only allow deleting from known pi directories
    const home = homedir();
    const allowedPrefixes = [
      join(home, ".pi", "agent", "extensions"),
      join(home, ".pi", "agent", "skills"),
      join(home, ".pi", "agent", "prompts"),
      join(home, ".pi", "agent", "themes"),
      join(home, ".pi", "agent", "git"),
      join(home, ".agents", "skills"),
    ];

    const safeTargetPath = await resolveContainedPath(targetPath, allowedPrefixes);

    if (!safeTargetPath) {
      return NextResponse.json(
        {
          error: "Cannot delete resources outside of pi directories",
          details: `Path ${targetPath} is not in an allowed directory`,
        },
        { status: 403 }
      );
    }

    // Check if path exists
    try {
      await access(safeTargetPath);
    } catch {
      return NextResponse.json(
        { error: "Path does not exist" },
        { status: 404 }
      );
    }

    // Determine if it's a file or directory
    const stats = await stat(safeTargetPath);

    if (stats.isDirectory()) {
      await rm(safeTargetPath, { recursive: true });
    } else {
      await rm(safeTargetPath);
    }

    return NextResponse.json({
      success: true,
      message: `Removed ${type || "resource"}: ${basename(targetPath)}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete resource", details: String(error) },
      { status: 500 }
    );
  }
}
