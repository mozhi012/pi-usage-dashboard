/**
 * Session Sources API
 *
 * Manages additional directories to scan for pi session files.
 * The default ~/.pi/agent/sessions/ is always included.
 * Users can add custom paths (e.g., Superconductor, team shared dirs).
 *
 * GET    /api/sources  - List all configured sources
 * POST   /api/sources  - Add a new source path
 * PUT    /api/sources  - Update a source (enable/disable, rename)
 * DELETE /api/sources?id=x - Remove a source
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getAllSessionSources,
  addSessionSource,
  updateSessionSource,
  deleteSessionSource,
} from "@/lib/db";
import { access, stat } from "fs/promises";
import { homedir } from "os";
import { requireMutationAuth } from "@/lib/api-security";
import { expandHome } from "@/lib/path-security";

export async function GET() {
  try {
    return NextResponse.json(getAllSessionSources());
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read sources", details: String(error) },
      { status: 500 }
    );
  }
}

async function validateSourcePath(path: string): Promise<NextResponse | null> {
  // Expand ~/ prefix to full home directory path before stat check
  const resolvedPath = expandHome(path, homedir());
  try {
    const stats = await stat(resolvedPath);
    if (!stats.isDirectory()) {
      return NextResponse.json({ error: `Path is not a directory: ${path}` }, { status: 400 });
    }
    await access(resolvedPath);
    return null;
  } catch {
    return NextResponse.json(
      { error: `Path does not exist or is not accessible: ${path}` },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { path, label } = body;

    if (!path || typeof path !== "string") {
      return NextResponse.json(
        { error: "path is required" },
        { status: 400 }
      );
    }

    const validationError = await validateSourcePath(path);
    if (validationError) return validationError;

    addSessionSource(path, label || path);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to add source", details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id, path, label, enabled } = body;

    if (!id || typeof id !== "number") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (path !== undefined) {
      if (typeof path !== "string") {
        return NextResponse.json({ error: "path must be a string" }, { status: 400 });
      }
      const validationError = await validateSourcePath(path);
      if (validationError) return validationError;
    }

    updateSessionSource(id, { path, label, enabled });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update source", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "id query param is required" },
        { status: 400 }
      );
    }

    deleteSessionSource(parseInt(id, 10));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete source", details: String(error) },
      { status: 500 }
    );
  }
}
