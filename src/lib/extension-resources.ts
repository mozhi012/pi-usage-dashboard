/**
 * Pi resource discovery (extensions, skills, prompts, themes).
 *
 * Mirrors the resource-resolution rules of the pi coding agent for plain
 * (non-glob) manifest paths (see pi docs/packages.md):
 *
 * - A package's `package.json` may declare a `pi` manifest whose
 *   `extensions` / `skills` / `prompts` / `themes` fields are arrays of
 *   paths relative to the package root.
 * - An extension entry that is a file is a single extension (must be
 *   `.ts` or `.js`). An extension entry that is a directory is resolved
 *   like a resource root: an inner `package.json` `pi.extensions` takes
 *   priority, then `index.ts`/`index.js` (counted as ONE extension), then
 *   the conventional scan (top-level `.ts`/`.js` files, plus
 *   subdirectories that resolve to entries themselves).
 * - `pi.extensions: []` loads nothing; an absent `extensions` key falls
 *   back to the conventional `extensions/` directory.
 * - Glob patterns and `!` exclusions are NOT supported here; such entries
 *   are skipped with a warning.
 * - npm-installed packages live in `~/.pi/agent/npm/node_modules`
 *   (user-level), in addition to the system npm global directory.
 */
import { readdir, readFile, stat, realpath } from "fs/promises";
import { join, basename, resolve } from "path";

export interface ResourceItem {
  name: string;
  type: "extension" | "skill" | "prompt" | "theme";
  scope: "global" | "package";
  path: string;
  description?: string;
  packageName?: string;
}

export type Warnings = string[];

const EXT_FILE_RE = /\.(ts|js)$/;
const GLOB_RE = /[*?{[]/;
const SKIP_DIRS = new Set(["node_modules"]);

/** Record a warning on the caller's list and surface it via console.warn. */
export function warn(warnings: Warnings | undefined, message: string) {
  warnings?.push(message);
  console.warn(`[pi-resources] ${message}`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function statOrNull(p: string) {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

/** Canonical key for cycle detection (resolves symlinks where possible). */
async function dirKey(p: string): Promise<string> {
  let canonical: string;
  try {
    canonical = await realpath(p);
  } catch {
    canonical = resolve(p);
  }
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

async function readPackageJson(
  pkgDir: string,
  warnings?: Warnings
): Promise<Record<string, unknown> | null> {
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!(await pathExists(pkgJsonPath))) return null;
  try {
    let raw = await readFile(pkgJsonPath, "utf-8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch (err) {
    warn(warnings, `cannot parse ${pkgJsonPath}: ${String(err)}`);
    return null;
  }
}

export function isPiPackage(pkg: Record<string, unknown> | null): boolean {
  if (!pkg) return false;
  if (typeof pkg.pi === "object" && pkg.pi !== null) return true;
  return Array.isArray(pkg.keywords) && pkg.keywords.includes("pi-package");
}

function getManifestEntries(
  pkg: Record<string, unknown> | null,
  field: "extensions" | "skills" | "prompts" | "themes"
): string[] | null {
  const pi = pkg?.pi;
  if (typeof pi !== "object" || pi === null) return null;
  const entries = (pi as Record<string, unknown>)[field];
  if (!Array.isArray(entries)) return null;
  return entries.filter((e): e is string => typeof e === "string");
}

function stripResourceExt(name: string): string {
  return name.replace(/\.(ts|js|md|json)$/, "");
}

function toPosix(p: string): string {
  return p.split("\\").join("/");
}

function isUnsupportedEntry(entry: string): boolean {
  return entry.startsWith("!") || GLOB_RE.test(entry);
}

/**
 * Resolve a directory as a resource entry (the "is this directory itself a
 * single entry?" question pi asks of subdirectories):
 * - inner `pi.extensions` manifest wins (an explicit `[]` means nothing)
 * - then `index.ts`/`index.js` → one extension
 * - otherwise null (the directory is not an entry on its own)
 *
 * `visited` (canonical directory keys) guards against symlink/manifest cycles.
 */
async function resolveDirEntries(
  dir: string,
  scope: "global" | "package",
  packageName: string | undefined,
  warnings: Warnings,
  visited: Set<string>
): Promise<ResourceItem[] | null> {
  const key = await dirKey(dir);
  if (visited.has(key)) return null;
  visited.add(key);

  const pkg = await readPackageJson(dir, warnings);
  const manifest = getManifestEntries(pkg, "extensions");
  if (manifest) {
    if (manifest.length === 0) return []; // explicit [] loads nothing
    const items: ResourceItem[] = [];
    for (const entry of manifest) {
      if (isUnsupportedEntry(entry)) {
        warn(
          warnings,
          `unsupported manifest entry "${entry}" in ${dir}/package.json; skipped`
        );
        continue;
      }
      items.push(
        ...(await resolveExtensionEntry(
          join(dir, toPosix(entry).replace(/^\.\//, "")),
          scope,
          packageName,
          warnings,
          visited
        ))
      );
    }
    return items;
  }

  for (const idx of ["index.ts", "index.js"]) {
    const indexPath = join(dir, idx);
    if ((await statOrNull(indexPath))?.isFile()) {
      return [
        {
          name: stripResourceExt(idx),
          type: "extension",
          scope,
          path: indexPath,
          packageName,
        },
      ];
    }
  }
  return null;
}

/**
 * Resolve a single plain manifest entry (file or directory) into
 * extension resource items.
 *
 * - file: must be a real file with `.ts`/`.js` extension → one extension
 * - directory: own `pi.extensions` manifest, then `index.ts`/`index.js`
 *   (one extension), then the conventional scan (top-level `.ts`/`.js`
 *   files, plus subdirectories that resolve to entries themselves).
 *   A directory with no resolvable entries yields zero items.
 */
async function resolveExtensionEntry(
  entryAbs: string,
  scope: "global" | "package",
  packageName: string | undefined,
  warnings: Warnings,
  visited: Set<string>
): Promise<ResourceItem[]> {
  const s = await statOrNull(entryAbs);
  if (!s) {
    warn(warnings, `extension entry ${entryAbs} not found`);
    return [];
  }

  if (s.isFile()) {
    if (!EXT_FILE_RE.test(entryAbs)) {
      warn(warnings, `extension entry ${entryAbs} is not a .ts/.js file; skipped`);
      return [];
    }
    return [
      {
        name: stripResourceExt(basename(entryAbs)),
        type: "extension",
        scope,
        path: entryAbs,
        packageName,
      },
    ];
  }

  if (!s.isDirectory()) return [];

  // Cycle guard: a directory already on the recursion stack resolves to
  // nothing on re-entry (shared/cyclic references count once).
  if (visited.has(await dirKey(entryAbs))) return [];

  const resolved = await resolveDirEntries(
    entryAbs,
    scope,
    packageName,
    warnings,
    visited
  );
  if (resolved !== null) return resolved;

  // Conventional scan: top-level .ts/.js files, plus subdirectories that
  // resolve to entries themselves (own manifest or index). Plain files in
  // a subdirectory without its own entry are NOT extensions (pi semantics).
  const items: ResourceItem[] = [];
  let entries;
  try {
    entries = await readdir(entryAbs, { withFileTypes: true });
  } catch (err) {
    warn(warnings, `cannot read ${entryAbs}: ${String(err)}`);
    return items;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(entryAbs, entry.name);
    if (entry.isFile() && EXT_FILE_RE.test(entry.name)) {
      items.push({
        name: stripResourceExt(entry.name),
        type: "extension",
        scope,
        path: full,
        packageName,
      });
    } else if (entry.isDirectory()) {
      const sub = await resolveDirEntries(
        full,
        scope,
        packageName,
        warnings,
        visited
      );
      if (sub) items.push(...sub);
    }
  }
  return items;
}

/**
 * Scan a directory for extensions: its `pi` manifest entries when present
 * (including an explicit `[]` → nothing), otherwise the conventional
 * scan of the directory itself.
 */
export async function scanExtensionsDir(
  dir: string,
  scope: "global" | "package",
  packageName?: string,
  warnings: Warnings = []
): Promise<ResourceItem[]> {
  if (!(await pathExists(dir))) return [];

  const pkg = await readPackageJson(dir, warnings);
  const manifest = getManifestEntries(pkg, "extensions");
  if (manifest) {
    if (manifest.length === 0) return [];
    const items: ResourceItem[] = [];
    const seen = new Set<string>();
    const visited = new Set<string>();
    for (const entry of manifest) {
      if (isUnsupportedEntry(entry)) {
        warn(
          warnings,
          `unsupported manifest entry "${entry}" in ${dir}/package.json; skipped`
        );
        continue;
      }
      for (const item of await resolveExtensionEntry(
        join(dir, toPosix(entry).replace(/^\.\//, "")),
        scope,
        packageName,
        warnings,
        visited
      )) {
        if (seen.has(item.path)) continue;
        seen.add(item.path);
        items.push(item);
      }
    }
    return items;
  }
  return resolveExtensionEntry(dir, scope, packageName, warnings, new Set<string>());
}

/**
 * Scan a directory for skills: each immediate subdirectory containing
 * SKILL.md is a skill (shallow, as before this rework).
 */
export async function scanSkills(
  dir: string,
  scope: "global" | "package",
  packageName?: string,
  warnings: Warnings = []
): Promise<ResourceItem[]> {
  const items: ResourceItem[] = [];
  if (!(await pathExists(dir))) return items;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    warn(warnings, `cannot read ${dir}: ${String(err)}`);
    return items;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillPath = join(dir, entry.name);
    const skillFile = join(skillPath, "SKILL.md");

    if (await pathExists(skillFile)) {
      let description = "";
      try {
        const content = await readFile(skillFile, "utf-8");
        // Parse YAML frontmatter description
        const match = content.match(/description:\s*["']?(.+?)["']?\s*[\n-]/);
        if (match) description = match[1].trim().slice(0, 120);
      } catch {
        // no description
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
  return items;
}

export async function scanPrompts(
  dir: string,
  scope: "global" | "package",
  packageName?: string,
  warnings: Warnings = []
): Promise<ResourceItem[]> {
  const items: ResourceItem[] = [];
  if (!(await pathExists(dir))) return items;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    warn(warnings, `cannot read ${dir}: ${String(err)}`);
    return items;
  }
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
  return items;
}

export async function scanThemes(
  dir: string,
  scope: "global" | "package",
  packageName?: string,
  warnings: Warnings = []
): Promise<ResourceItem[]> {
  const items: ResourceItem[] = [];
  if (!(await pathExists(dir))) return items;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    warn(warnings, `cannot read ${dir}: ${String(err)}`);
    return items;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (
      entry.isFile() &&
      (entry.name.endsWith(".json") || entry.name.endsWith(".ts"))
    ) {
      items.push({
        name: entry.name.replace(/\.(json|ts)$/, ""),
        type: "theme",
        scope,
        path: join(dir, entry.name),
        packageName,
      });
    }
  }
  return items;
}

/**
 * Scan one package directory using its `pi` manifest (when present) and
 * conventional directories otherwise.
 */
export async function scanPackage(
  pkgDir: string,
  scope: "global" | "package",
  warnings: Warnings = []
): Promise<ResourceItem[]> {
  const pkg = await readPackageJson(pkgDir, warnings);
  const pkgName =
    typeof pkg?.name === "string" && pkg.name ? pkg.name : basename(pkgDir);
  const items: ResourceItem[] = [];

  // Extensions: explicit manifest wins (including [] → nothing).
  const extEntries = getManifestEntries(pkg, "extensions");
  if (extEntries) {
    if (extEntries.length > 0) {
      items.push(
        ...(await scanExtensionsDir(pkgDir, scope, pkgName, warnings))
      );
    }
  } else if (await pathExists(join(pkgDir, "extensions"))) {
    items.push(
      ...(await scanExtensionsDir(join(pkgDir, "extensions"), scope, pkgName, warnings))
    );
  }

  // Skills: manifest entries (plain paths) or conventional skills/.
  const skillEntries = getManifestEntries(pkg, "skills");
  const skillList =
    skillEntries ?? (await pathExists(join(pkgDir, "skills")) ? ["./skills"] : []);
  for (const entry of skillList) {
    if (isUnsupportedEntry(entry)) {
      warn(warnings, `unsupported skills entry "${entry}" in ${pkgDir}; skipped`);
      continue;
    }
    const abs = join(pkgDir, toPosix(entry).replace(/^\.\//, ""));
    const s = await statOrNull(abs);
    if (!s) {
      warn(warnings, `skills entry ${entry} of ${pkgName} not found at ${abs}`);
      continue;
    }
    if (s.isDirectory()) {
      items.push(...(await scanSkills(abs, scope, pkgName, warnings)));
    } else if (s.isFile() && abs.endsWith(".md")) {
      items.push({
        name: abs.replace(/\.md$/, "").replace(/.*[\\/]/, ""),
        type: "skill",
        scope,
        path: abs,
        packageName: pkgName,
      });
    }
  }

  // Prompts: manifest entries (plain paths) or conventional prompts/.
  const promptEntries = getManifestEntries(pkg, "prompts");
  const promptList =
    promptEntries ??
    (await pathExists(join(pkgDir, "prompts")) ? ["./prompts"] : []);
  for (const entry of promptList) {
    if (isUnsupportedEntry(entry)) {
      warn(warnings, `unsupported prompts entry "${entry}" in ${pkgDir}; skipped`);
      continue;
    }
    const abs = join(pkgDir, toPosix(entry).replace(/^\.\//, ""));
    const s = await statOrNull(abs);
    if (!s) {
      warn(warnings, `prompts entry ${entry} of ${pkgName} not found at ${abs}`);
      continue;
    }
    if (s.isDirectory()) {
      items.push(...(await scanPrompts(abs, scope, pkgName, warnings)));
    } else if (s.isFile() && abs.endsWith(".md")) {
      items.push({
        name: abs.replace(/\.md$/, "").replace(/.*[\\/]/, ""),
        type: "prompt",
        scope,
        path: abs,
        packageName: pkgName,
      });
    }
  }

  // Themes: manifest entries (plain paths) or conventional themes/.
  const themeEntries = getManifestEntries(pkg, "themes");
  const themeList =
    themeEntries ??
    (await pathExists(join(pkgDir, "themes")) ? ["./themes"] : []);
  for (const entry of themeList) {
    if (isUnsupportedEntry(entry)) {
      warn(warnings, `unsupported themes entry "${entry}" in ${pkgDir}; skipped`);
      continue;
    }
    const abs = join(pkgDir, toPosix(entry).replace(/^\.\//, ""));
    const s = await statOrNull(abs);
    if (!s) {
      warn(warnings, `themes entry ${entry} of ${pkgName} not found at ${abs}`);
      continue;
    }
    if (s.isDirectory()) {
      items.push(...(await scanThemes(abs, scope, pkgName, warnings)));
    } else if (s.isFile() && (abs.endsWith(".json") || abs.endsWith(".ts"))) {
      items.push({
        name: abs.replace(/\.(json|ts)$/, "").replace(/.*[\\/]/, ""),
        type: "theme",
        scope,
        path: abs,
        packageName: pkgName,
      });
    }
  }

  return items;
}

/**
 * Scan an npm `node_modules` directory for pi packages (unscoped and
 * `@scope/`-scoped). Non-pi packages are skipped.
 */
export async function scanNpmNodeModules(
  nmDir: string,
  warnings: Warnings = []
): Promise<ResourceItem[]> {
  const items: ResourceItem[] = [];
  if (!(await pathExists(nmDir))) return items;
  let entries;
  try {
    entries = await readdir(nmDir, { withFileTypes: true });
  } catch (err) {
    warn(warnings, `cannot read ${nmDir}: ${String(err)}`);
    return items;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const base = join(nmDir, entry.name);
    if (entry.name.startsWith("@")) {
      let scoped;
      try {
        scoped = await readdir(base, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sub of scoped) {
        if (!sub.isDirectory()) continue;
        const pkgDir = join(base, sub.name);
        const pkg = await readPackageJson(pkgDir, warnings);
        if (isPiPackage(pkg)) {
          items.push(...(await scanPackage(pkgDir, "package", warnings)));
        }
      }
    } else {
      const pkg = await readPackageJson(base, warnings);
      if (isPiPackage(pkg)) {
        items.push(...(await scanPackage(base, "package", warnings)));
      }
    }
  }
  return items;
}
