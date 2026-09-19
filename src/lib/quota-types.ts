export type QuotaProviderId = "openai-codex" | "antigravity";

export interface QuotaWindow {
  id: string;
  label: string;
  remainingPercent: number;
  resetAt: string | null;
}

export interface ProviderQuota {
  id: QuotaProviderId;
  name: string;
  status: "ok" | "unauthenticated" | "expired" | "unavailable";
  quotas: QuotaWindow[];
  updatedAt: string | null;
  stale: boolean;
  message?: string;
  plan?: string;
}

export interface QuotaResponse { providers: ProviderQuota[] }
