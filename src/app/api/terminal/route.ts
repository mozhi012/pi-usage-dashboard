/**
 * Terminal Launch API
 *
 * Opens a new terminal window with pi in the specified working directory.
 * Supports macOS, Linux, and Windows.
 *
 * POST /api/terminal
 * Body: { cwd: string, sessionId?: string, sessionFile?: string, action?: "resume" | "fork" }
 */
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { platform } from "os";
import { stat } from "fs/promises";
import { expandHome } from "@/lib/path-security";
import { requireMutationAuth } from "@/lib/api-security";
import { resolveAllowedSessionFile } from "@/lib/session-paths";
import { shellQuote } from "@/lib/command";

function buildPiArgs(action?: string, sessionFile?: string, sessionId?: string): string[] {
  const sessionRef = sessionFile || sessionId;
  if (action === "resume" && sessionRef) return ["--session", sessionRef];
  if (action === "fork" && sessionRef) return ["--fork", sessionRef];
  if (action && action !== "resume" && action !== "fork") throw new Error("Invalid terminal action");
  return [];
}

function buildPiShellCommand(args: string[]): string {
  return ["pi", ...args.map(shellQuote)].join(" ");
}

function execFileResponse(file: string, args: string[]): Promise<NextResponse> {
  return new Promise((resolve) => {
    execFile(file, args, (error) => {
      if (error) {
        resolve(
          NextResponse.json(
            { error: "Failed to open terminal", details: error.message },
            { status: 500 }
          )
        );
      } else {
        resolve(NextResponse.json({ success: true }));
      }
    });
  });
}

function terminalCommandForPlatform(cwd: string, piArgs: string[]): { file: string; args: string[] } {
  const os = platform();
  const command = `cd ${shellQuote(cwd)} && ${buildPiShellCommand(piArgs)}`;

  if (os === "darwin") {
    return {
      file: "osascript",
      args: ["-e", `tell application "Terminal" to do script ${JSON.stringify(command)}`],
    };
  }

  if (os === "win32") {
    return {
      file: "cmd.exe",
      args: ["/c", "start", "cmd", "/k", `cd /d "${cwd.replace(/"/g, '""')}" && pi ${piArgs.map((arg) => `"${arg.replace(/"/g, '""')}"`).join(" ")}`],
    };
  }

  return {
    file: "sh",
    args: [
      "-c",
      "if command -v x-terminal-emulator >/dev/null 2>&1; then exec x-terminal-emulator -e bash -lc \"$1; exec bash\"; elif command -v gnome-terminal >/dev/null 2>&1; then exec gnome-terminal -- bash -lc \"$1; exec bash\"; elif command -v konsole >/dev/null 2>&1; then exec konsole -e bash -lc \"$1; exec bash\"; else exec xterm -e bash -lc \"$1; exec bash\"; fi",
      "terminal-launch",
      command,
    ],
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { cwd, sessionId, sessionFile, action } = body;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const resolvedCwd = expandHome(cwd, homeDir);
    const cwdStats = await stat(resolvedCwd).catch(() => null);
    if (!cwdStats?.isDirectory()) {
      return NextResponse.json({ error: "cwd must be an existing directory" }, { status: 400 });
    }

    let safeSessionFile: string | undefined;
    if (sessionFile !== undefined) {
      if (typeof sessionFile !== "string") {
        return NextResponse.json({ error: "sessionFile must be a string" }, { status: 400 });
      }
      const resolved = await resolveAllowedSessionFile(sessionFile);
      if (!resolved) {
        return NextResponse.json(
          { error: "sessionFile must be a .jsonl file inside a configured session directory" },
          { status: 403 }
        );
      }
      safeSessionFile = resolved;
    }

    const piArgs = buildPiArgs(action, safeSessionFile, typeof sessionId === "string" ? sessionId : undefined);
    const terminalCommand = terminalCommandForPlatform(resolvedCwd, piArgs);
    return execFileResponse(terminalCommand.file, terminalCommand.args);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to launch terminal", details: String(error) },
      { status: 500 }
    );
  }
}
