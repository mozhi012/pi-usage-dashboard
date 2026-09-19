export type QuotaProviderId = "openai-codex" | "antigravity";

/** One underlying model quota inside an Antigravity family group. */
export interface QuotaWindowMember {
  id: string;
  label: string;
  remainingPercent: number;
  resetAt: string | null;
}

export interface QuotaWindow {
  id: string;
  label: string;
  remainingPercent: number;
  resetAt: string | null;
  /** Present only for Antigravity family groups (gemini / claude). */
  members?: QuotaWindowMember[];
  /** Set when members disagree on remainingPercent or resetAt. */
  inconsistent?: boolean;
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
