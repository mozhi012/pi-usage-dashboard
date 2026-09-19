import { NextRequest, NextResponse } from "next/server";
import { requireMutationAuth } from "@/lib/api-security";
import { getProviderQuotas } from "@/lib/provider-quotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireMutationAuth(request);
  if (denied) return denied;
  const data = await getProviderQuotas(request.nextUrl.searchParams.get("refresh") === "1");
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
