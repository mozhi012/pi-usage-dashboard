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
import { readdir, access, rm, stat } from "fs/promises";
import type { Dirent } from "fs";
import { join, basename, resolve } from "path";
import { homedir } from "os";
import { exec } from "child_process";
import { requireMutationAuth } from "@/lib/api-security";
import { resolveContainedPath } from "@/lib/path-security";
import {
  type ResourceItem,
  type Warnings,
  warn,
  scanExtensionsDir,
  scanSkills,
  scanPrompts,
  scanThemes,
  scanPackage,
  scanNpmNodeModules,
} from "@/lib/extension-resources";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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

    const warnings: Warnings = [];
    const items: ResourceItem[] = [];

    // Global pi resources
    items.push(...(await scanExtensionsDir(join(piDir, "extensions"), "global", undefined, warnings)));
    items.push(...(await scanSkills(join(piDir, "skills"), "global", undefined, warnings)));
    items.push(...(await scanSkills(join(agentsDir, "skills"), "global", undefined, warnings)));
    items.push(...(await scanPrompts(join(piDir, "prompts"), "global", undefined, warnings)));
    items.push(...(await scanThemes(join(piDir, "themes"), "global", undefined, warnings)));

    // Installed packages (git)
    const gitDir = join(piDir, "git");
    if (await exists(gitDir)) {
      let gitEntries: Dirent[];
      try {
        gitEntries = await readdir(gitDir, { withFileTypes: true });
      } catch (err) {
        warn(warnings, `cannot read ${gitDir}: ${String(err)}`);
        gitEntries = [];
      }
      for (const entry of gitEntries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        items.push(...(await scanPackage(join(gitDir, entry.name), "package", warnings)));
      }
    }

    // Installed packages (pi user-level npm: ~/.pi/agent/npm/node_modules)
    const piNpmDir = join(piDir, "npm", "node_modules");
    items.push(...(await scanNpmNodeModules(piNpmDir, warnings)));

    // Installed packages (system npm global) — resolve dynamically. Skip when
    // it is the same directory as the pi npm root (avoids a double scan).
    const npmGlobalDir = await findNpmGlobalDir();
    const norm = (p: string) => {
      const absolute = resolve(p);
      return process.platform === "win32" ? absolute.toLowerCase() : absolute;
    };
    if (
      npmGlobalDir &&
      norm(npmGlobalDir) !== norm(piNpmDir) &&
      (await exists(npmGlobalDir))
    ) {
      items.push(...(await scanNpmNodeModules(npmGlobalDir, warnings)));
    }

    // Deduplicate by type + case-normalized absolute path (Windows paths are
    // case-insensitive; a package could appear in more than one location).
    const seen = new Set<string>();
    const unique: ResourceItem[] = [];
    for (const item of items) {
      const key = `${item.type}:${norm(item.path)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    return NextResponse.json(unique);
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
