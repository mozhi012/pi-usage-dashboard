/**
 * Model Pricing API
 *
 * CRUD operations for per-model token pricing.
 * Prices are stored per 1M tokens and used to calculate costs from session usage data.
 *
 * GET    /api/pricing          - List all configured pricing
 * POST   /api/pricing          - Create or update pricing for a model
 * DELETE /api/pricing?model=x   - Remove pricing for a model
 */
import { NextRequest, NextResponse } from "next/server";
import { getAllPricing, upsertPricing, deletePricing } from "@/lib/db";
import { requireMutationAuth } from "@/lib/api-security";

export async function GET() {
  try {
    const pricing = getAllPricing();
    return NextResponse.json(pricing);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read pricing", details: String(error) },
      { status: 500 }
    );
  }
}

function parsePrice(value: unknown, field: string): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
  return number;
}

export async function POST(request: NextRequest) {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { model, inputPrice, outputPrice, cacheReadPrice, cacheWritePrice } =
      body;

    if (!model || typeof model !== "string") {
      return NextResponse.json(
        { error: "model is required" },
        { status: 400 }
      );
    }

    let parsedInput: number;
    let parsedOutput: number;
    let parsedCacheRead: number;
    let parsedCacheWrite: number;
    try {
      parsedInput = parsePrice(inputPrice, "inputPrice");
      parsedOutput = parsePrice(outputPrice, "outputPrice");
      parsedCacheRead = parsePrice(cacheReadPrice, "cacheReadPrice");
      parsedCacheWrite = parsePrice(cacheWritePrice, "cacheWritePrice");
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
    upsertPricing({
      model,
      inputPrice: parsedInput,
      outputPrice: parsedOutput,
      cacheReadPrice: parsedCacheRead,
      cacheWritePrice: parsedCacheWrite,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save pricing", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireMutationAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const model = searchParams.get("model");

    if (!model) {
      return NextResponse.json(
        { error: "model query param is required" },
        { status: 400 }
      );
    }

    deletePricing(model);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete pricing", details: String(error) },
      { status: 500 }
    );
  }
}
