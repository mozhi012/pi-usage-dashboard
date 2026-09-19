import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/provider-quotas", () => ({ getProviderQuotas: vi.fn(async () => ({ providers: [] })) }));
import { getProviderQuotas } from "@/lib/provider-quotas";
import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());
it("returns no-store quota data and passes refresh flag", async () => {
  const response = await GET(new NextRequest("http://localhost/api/quotas?refresh=1", { headers: { host: "localhost" } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(getProviderQuotas).toHaveBeenCalledWith(true);
});
it("rejects foreign origin before requesting quota", async () => {
  const response = await GET(new NextRequest("http://localhost/api/quotas", { headers: { host: "localhost", origin: "https://evil.example" } }));
  expect(response.status).toBe(403);
  expect(getProviderQuotas).not.toHaveBeenCalled();
});
