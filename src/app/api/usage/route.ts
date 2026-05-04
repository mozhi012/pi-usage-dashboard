/**
 * Usage Data API
 *
 * Reads and aggregates token usage from all configured session sources.
 * Returns summary stats, per-model/project/day/week/month breakdowns.
 *
 * GET /api/usage
 */
import { NextResponse } from "next/server";
import { getAllUsageData } from "@/lib/parse-sessions";

export async function GET() {
  try {
    const data = await getAllUsageData();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read session data", details: String(error) },
      { status: 500 }
    );
  }
}
