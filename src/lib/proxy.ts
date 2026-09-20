// Server-side only: resolves the outbound HTTP(S) proxy for upstream quota requests.
//
// undici's EnvHttpProxyAgent only reads process env vars (HTTP_PROXY / HTTPS_PROXY /
// ALL_PROXY + lowercase). A `next start`/`next dev` process launched from a shell that
// does NOT export those vars would otherwise hit chatgpt.com / googleapis.com directly,
// which fails on networks that need a proxy (DNS / connection errors). This module adds
// a file-based fallback so the dashboard keeps working regardless of how it is launched.
//
// Resolution priority:
//   1. explicit PROXY_URL env var (highest)
//   2. standard HTTP(S)_PROXY / ALL_PROXY env vars  -> return null and let undici read them
//   3. local .pi-proxy file (first non-empty, non-comment line, a proxy URL)
//   4. no proxy (direct connection)

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PROXY_FILE_NAME = ".pi-proxy";

export type ProxyOptions = { httpProxy?: string; httpsProxy?: string };

/** Reads the first usable proxy URL from the local config file. Never throws. */
export function readProxyFile(dir: string = process.cwd()): string | null {
  let text: string;
  try {
    text = readFileSync(join(dir, PROXY_FILE_NAME), "utf8");
  } catch {
    return null;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line && !line.startsWith("#")) return line;
  }
  return null;
}

const STANDARD_ENV_KEYS = [
  "HTTPS_PROXY", "https_proxy",
  "HTTP_PROXY", "http_proxy",
  "ALL_PROXY", "all_proxy",
] as const;

/**
 * Returns proxy options for undici's EnvHttpProxyAgent, or `null` meaning
 * "no override — use process env (standard) or direct connection".
 * Pure and dependency-injected so tests can pass env/file explicitly.
 */
export function resolveProxyOptions(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  file: string | null = readProxyFile(),
): ProxyOptions | null {
  const explicit = env.PROXY_URL?.trim();
  if (explicit) return { httpProxy: explicit, httpsProxy: explicit };
  if (STANDARD_ENV_KEYS.some(key => env[key]?.trim())) return null;
  if (file) return { httpProxy: file, httpsProxy: file };
  return null;
}
