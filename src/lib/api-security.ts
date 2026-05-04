import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { constants, existsSync } from "fs";
import { access } from "fs/promises";
import { randomBytes } from "crypto";
import { join } from "path";
import { homedir } from "os";

const TOKEN_PATH = join(homedir(), ".pi", "agent", "usage-dashboard-token");
const SAFE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

async function ensureToken(): Promise<string> {
  if (process.env.PI_USAGE_DASHBOARD_TOKEN) return process.env.PI_USAGE_DASHBOARD_TOKEN;
  try {
    return (await readFile(TOKEN_PATH, "utf-8")).trim();
  } catch {
    const token = randomBytes(32).toString("hex");
    await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
    await writeFile(TOKEN_PATH, token, { mode: 0o600 });
    return token;
  }
}

function hostName(value: string | null): string | null {
  if (!value) return null;
  return value.split(":")[0]?.toLowerCase() || null;
}

export function isSafeLocalRequest(request: NextRequest): boolean {
  const host = hostName(request.headers.get("host"));
  if (host && !SAFE_HOSTS.has(host)) return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return SAFE_HOSTS.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function requireMutationAuth(request: NextRequest): Promise<NextResponse | null> {
  if (!isSafeLocalRequest(request)) {
    return NextResponse.json({ error: "Forbidden host or origin" }, { status: 403 });
  }

  const expected = await ensureToken();
  const provided = request.headers.get("x-pi-usage-token");
  if (provided !== expected) {
    return NextResponse.json({ error: "Missing or invalid dashboard token" }, { status: 401 });
  }

  return null;
}

export async function canAccessPath(pathname: string): Promise<boolean> {
  try {
    await access(pathname, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function dashboardTokenExists(): boolean {
  return existsSync(TOKEN_PATH) || Boolean(process.env.PI_USAGE_DASHBOARD_TOKEN);
}
