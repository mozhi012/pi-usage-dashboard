import { realpath } from "fs/promises";
import { isAbsolute, relative, resolve } from "path";

export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function realpathIfExists(pathname: string): Promise<string> {
  return realpath(pathname);
}

export async function resolveContainedPath(
  targetPath: string,
  allowedRoots: string[]
): Promise<string | null> {
  const targetRealPath = await realpathIfExists(targetPath);

  for (const root of allowedRoots) {
    try {
      const rootRealPath = await realpathIfExists(root);
      if (isPathInside(rootRealPath, targetRealPath)) {
        return targetRealPath;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function hasJsonlExtension(pathname: string): boolean {
  return pathname.toLowerCase().endsWith(".jsonl");
}

export function expandHome(pathname: string, homeDir: string): string {
  if (pathname === "~") return homeDir;
  if (pathname.startsWith("~/")) {
    return resolve(homeDir, pathname.slice(2));
  }
  return pathname;
}
