// Client for the operator-admin edge function. UX only - the function
// re-checks profiles.is_platform_operator on every call.
import { supabase } from "@/integrations/supabase/client";

async function readErrorPayloadFromContext(error: unknown): Promise<unknown> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!context || typeof context !== "object") return null;
  const res = context as { json?: () => Promise<unknown>; clone?: () => unknown };
  const source = typeof res.clone === "function" ? (res.clone() as typeof res) : res;
  if (typeof source.json === "function") {
    try {
      return await source.json();
    } catch {
      return null;
    }
  }
  return null;
}

export async function operatorAdmin<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("operator-admin", { body: { action, ...payload } });
  if (error) {
    const body = ((await readErrorPayloadFromContext(error)) ?? data) as { error?: string } | null;
    throw new Error(body?.error || error.message || "Request failed");
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export type AdminOverview = {
  workspaces: number;
  newWorkspaces30d: number;
  users: number;
  subscriptions: { total: number; byPlan: Record<string, { name: string; count: number }>; pastDueOrGrace: number };
  mrrMinor: number;
  revenue30dMinor: number;
  currency: string;
  billingAlerts: { failedWebhooks7d: number; amountMismatches: number; pendingCheckouts: number };
  ai30d: { costUsd: number; tokens: number };
  failures7d: { automations: number; contentPosts: number };
  businessProfilesWithWebsite: number;
};

export type AdminPrice = {
  id: string; plan_id: string; currency: string; amount_minor: number; billing_interval: "once" | "month" | "year";
  access_days: number | null; paystack_plan_code: string | null; is_active: boolean; created_at: string;
};
export type AdminPlanEntitlement = { plan_id: string; entitlement_key: string; bool_value: boolean | null; limit_value: number | null };
export type AdminPlan = {
  id: string; code: string; name: string; description: string | null; plan_kind: "free" | "one_off" | "subscription"; tier_rank: number;
  is_public: boolean; is_active: boolean; sort_order: number; marketing: { features?: string[]; cta?: string | null; badge?: string | null };
  billing_prices: AdminPrice[]; plan_entitlements: AdminPlanEntitlement[];
};
export type EntitlementDefinition = { key: string; name: string; description: string | null; kind: "boolean" | "limit" | "allowance"; unit: string | null };

export type AdminFlag = {
  key: string; name: string; description: string | null; category: string; is_enabled: boolean;
  audience: "everyone" | "operators" | "targeted"; plan_codes: string[]; rollout_percentage: number; updated_at: string;
};
export type AdminFlagTarget = { flag_key: string; workspace_id: string; enabled: boolean; reason: string; created_at: string; workspaces: { name: string; slug: string } | null };

export type AdminSetting = { key: string; value: unknown; description: string | null; is_public: boolean; updated_at: string };
