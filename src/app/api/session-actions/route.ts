/**
 * Session Actions API
 *
 * Perform operations on session files: export to HTML, share via GitHub Gist,
 * import into default pi sessions, or duplicate for backup.
 *
 * POST /api/session-actions
 * Body: { action: "export" | "share" | "import" | "duplicate", sessionFile: string, outputPath?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, access, copyFile, mkdtemp, rm, mkdir } from "fs/promises";
import { join, basename, dirname } from "path";
import { homedir, tmpdir } from "os";
import { randomUUID } from "crypto";
import { requireMutationAuth } from "@/lib/api-security";
import { execFileAsync } from "@/lib/command";
import { resolveAllowedSessionFile, getDefaultSessionsDir } from "@/lib/session-paths";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action, sessionFile, outputPath } = body;

    if (!sessionFile || typeof sessionFile !== "string") {
      return NextResponse.json(
        { error: "sessionFile is required" },
        { status: 400 }
      );
    }

    const safeSessionFile = await resolveAllowedSessionFile(sessionFile);
    if (!safeSessionFile) {
      return NextResponse.json(
        { error: "Session file must be a .jsonl file inside a configured session directory" },
        { status: 403 }
      );
    }

    try {
      await access(safeSessionFile);
    } catch {
      return NextResponse.json(
        { error: "Session file not found" },
        { status: 404 }
      );
    }

    switch (action) {
      case "export": {
        const outFile =
          typeof outputPath === "string" && outputPath.length > 0
            ? outputPath
            : join(
                homedir(),
                "Downloads",
                `pi-session-${basename(safeSessionFile, ".jsonl")}.html`
              );

        try {
          await execFileAsync("pi", ["--export", safeSessionFile, outFile], 30000);
          return NextResponse.json({
            success: true,
            outputPath: outFile,
            message: `Exported to ${outFile}`,
          });
        } catch (error) {
          return NextResponse.json(
            {
              error: "Export failed",
              details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
          );
        }
      }

      case "share": {
        const tempDir = await mkdtemp(join(tmpdir(), "pi-session-share-"));
        const tempFile = join(tempDir, "session.html");
        try {
          await execFileAsync("pi", ["--export", safeSessionFile, tempFile], 30000);
          const { stdout } = await execFileAsync(
            "gh",
            ["gist", "create", tempFile, "--private", "-d", "Pi session export"],
            30000
          );
          const gistUrl = stdout.trim();
          return NextResponse.json({
            success: true,
            url: gistUrl,
            message: `Shared privately at ${gistUrl}`,
          });
        } catch (error) {
          return NextResponse.json(
            {
              error: "Share failed - pi/gh CLI not available or not authenticated",
              details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
          );
        } finally {
          await rm(tempDir, { recursive: true, force: true });
        }
      }

      case "import": {
        const sessionsDir = getDefaultSessionsDir();
        const content = await readFile(safeSessionFile, "utf-8");
        const firstLine = content.split("\n")[0];
        let targetDir = join(sessionsDir, "--imported--");

        try {
          const header = JSON.parse(firstLine);
          if (typeof header.cwd === "string" && header.cwd.length > 0) {
            const dirName = "--" + header.cwd.replace(/\//g, "-").replace(/^-/, "") + "--";
            targetDir = join(sessionsDir, dirName);
          }
        } catch {
          // use default
        }

        await mkdir(targetDir, { recursive: true });

        const targetFile = join(targetDir, basename(safeSessionFile));
        await copyFile(safeSessionFile, targetFile);

        return NextResponse.json({
          success: true,
          importedTo: targetFile,
          message: `Imported to ${targetFile}`,
        });
      }

      case "duplicate": {
        const dir = dirname(safeSessionFile);
        const newName = `${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID()}.jsonl`;
        const targetFile = join(dir, newName);
        await copyFile(safeSessionFile, targetFile);

        return NextResponse.json({
          success: true,
          duplicatedTo: targetFile,
          message: `Duplicated to ${targetFile}`,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Action failed", details: String(error) },
      { status: 500 }
    );
  }
}
