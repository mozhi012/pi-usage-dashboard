import { homedir } from "os";
import { join } from "path";
import { getAllSessionSources } from "./db";
import { hasJsonlExtension, resolveContainedPath } from "./path-security";

export function getDefaultSessionsDir(): string {
  const customDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (customDir) return customDir;
  const customAgentDir = process.env.PI_CODING_AGENT_DIR;
  if (customAgentDir) return join(customAgentDir, "sessions");
  return join(homedir(), ".pi", "agent", "sessions");
}

export function getSessionDirs(): string[] {
  const dirs = [getDefaultSessionsDir()];
  try {
    for (const source of getAllSessionSources()) {
      if (source.enabled) dirs.push(source.path);
    }
  } catch {
    // DB may not be ready during startup/tests.
  }
  return Array.from(new Set(dirs));
}

export async function resolveAllowedSessionFile(sessionFile: string): Promise<string | null> {
  if (!hasJsonlExtension(sessionFile)) return null;
  return resolveContainedPath(sessionFile, getSessionDirs());
}
