// Billing: catalogue (plans/prices/entitlements), the workspace's current
// holdings, and the Paystack checkout/verify/cancel actions.
//
// Nothing here grants access. The browser only ever (a) asks the server to
// START a checkout and (b) asks the server to VERIFY a reference with
// Paystack; entitlements are always read back from the database evaluator
// (get_workspace_entitlements).
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

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const payload = ((await readErrorPayloadFromContext(error)) ?? data) as { error?: string } | null;
    throw new Error(payload?.error || error.message || `${name} failed`);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export type BillingInterval = "once" | "month" | "year";

export type CatalogPrice = {
  id: string;
  currency: string;
  amount_minor: number;
  billing_interval: BillingInterval;
  access_days: number | null;
  purchasable: boolean;
};

export type CatalogPlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  plan_kind: "free" | "one_off" | "subscription";
  tier_rank: number;
  marketing: { features?: string[]; cta?: string; badge?: string };
  prices: CatalogPrice[];
};

export type WorkspaceEntitlement = {
  entitlement_key: string;
  kind: "boolean" | "limit" | "allowance";
  enabled: boolean;
  limit_value: number | null;
  unlimited: boolean;
  used: number;
  source: string;
};

export function formatMoney(amountMinor: number, currency: string): string {
  const amount = amountMinor / 100;
  try {
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency, minimumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function intervalLabel(interval: BillingInterval): string {
  return interval === "month" ? "per month" : interval === "year" ? "per year" : "once-off";
}

/** Annual saving vs 12x monthly, as a whole percentage (null if not cheaper). */
export function annualSavingPercent(prices: CatalogPrice[]): number | null {
  const month = prices.find((p) => p.billing_interval === "month");
  const year = prices.find((p) => p.billing_interval === "year");
  if (!month || !year || month.currency !== year.currency || month.amount_minor <= 0) return null;
  const saving = 1 - year.amount_minor / (month.amount_minor * 12);
  return saving > 0.005 ? Math.round(saving * 100) : null;
}

export async function fetchCatalog(): Promise<CatalogPlan[]> {
  const { data, error } = await supabase
    .from("billing_plans")
    .select("id, code, name, description, plan_kind, tier_rank, marketing, sort_order, billing_prices(id, currency, amount_minor, billing_interval, access_days, paystack_plan_code, is_active)")
    .eq("is_active", true)
    .eq("is_public", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  type Row = {
    id: string; code: string; name: string; description: string | null; plan_kind: string; tier_rank: number; marketing: unknown;
    billing_prices: { id: string; currency: string; amount_minor: number; billing_interval: string; access_days: number | null; paystack_plan_code: string | null; is_active: boolean }[];
  };
  return ((data ?? []) as Row[]).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    plan_kind: p.plan_kind as CatalogPlan["plan_kind"],
    tier_rank: p.tier_rank,
    marketing: (p.marketing ?? {}) as CatalogPlan["marketing"],
    prices: (p.billing_prices ?? [])
      .filter((pr) => pr.is_active)
      .map((pr) => ({
        id: pr.id,
        currency: pr.currency,
        amount_minor: Number(pr.amount_minor),
        billing_interval: pr.billing_interval as BillingInterval,
        access_days: pr.access_days,
        // A recurring price needs its Paystack plan configured by an operator.
        purchasable: pr.billing_interval === "once" || !!pr.paystack_plan_code,
      }))
      .sort((a, b) => (a.billing_interval === b.billing_interval ? 0 : a.billing_interval === "month" ? -1 : 1)),
  }));
}

export async function fetchEntitlements(workspaceId: string): Promise<WorkspaceEntitlement[]> {
  const { data, error } = await supabase.rpc("get_workspace_entitlements", { p_workspace_id: workspaceId });
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkspaceEntitlement[];
}

export type SubscriptionPrice = { amount_minor: number; currency: string; billing_interval: BillingInterval };

export type WorkspaceBillingState = {
  subscription: {
    id: string;
    status: string;
    current_period_end: string | null;
    grace_until: string | null;
    cancel_at_period_end: boolean;
    plan: { code: string; name: string } | null;
    price: SubscriptionPrice | null;
  } | null;
  purchases: { id: string; status: string; paid_at: string | null; access_expires_at: string | null; plan: { name: string } | null }[];
  transactions: { reference: string; kind: string; status: string; amount_minor: number; currency: string; paid_at: string | null; created_at: string }[];
};

export async function fetchBillingState(workspaceId: string): Promise<WorkspaceBillingState> {
  const [subs, purchases, transactions] = await Promise.all([
    supabase
      .from("workspace_subscriptions")
      .select("id, status, current_period_end, grace_until, cancel_at_period_end, created_at, billing_plans(code, name), billing_prices(amount_minor, currency, billing_interval)")
      .eq("workspace_id", workspaceId)
      .in("status", ["active", "past_due", "grace", "cancelled"])
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("workspace_purchases").select("id, status, paid_at, access_expires_at, billing_plans(name)").eq("workspace_id", workspaceId).eq("status", "paid").order("paid_at", { ascending: false }),
    supabase.from("billing_transactions").select("reference, kind, status, amount_minor, currency, paid_at, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(20),
  ]);
  const err = subs.error || purchases.error || transactions.error;
  if (err) throw new Error(err.message);
  const s = subs.data?.[0] as Record<string, unknown> | undefined;
  return {
    subscription: s
      ? {
          id: s.id as string,
          status: s.status as string,
          current_period_end: s.current_period_end as string | null,
          grace_until: s.grace_until as string | null,
          cancel_at_period_end: !!s.cancel_at_period_end,
          plan: (s.billing_plans as { code: string; name: string } | null) ?? null,
          price: (s.billing_prices as SubscriptionPrice | null) ?? null,
        }
      : null,
    purchases: ((purchases.data ?? []) as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      status: p.status as string,
      paid_at: p.paid_at as string | null,
      access_expires_at: p.access_expires_at as string | null,
      plan: (p.billing_plans as { name: string } | null) ?? null,
    })),
    transactions: (transactions.data ?? []) as WorkspaceBillingState["transactions"],
  };
}

export function startCheckout(workspaceId: string, priceId: string) {
  return invoke<{ ok: true; reference: string; authorization_url: string }>("billing-checkout", { workspace_id: workspaceId, price_id: priceId });
}

export type VerifyStatus = "success" | "pending" | "failed" | "needs_review";

export function verifyPayment(workspaceId: string, reference: string) {
  return invoke<{ ok: true; status: VerifyStatus }>("billing-actions", { action: "verify", workspace_id: workspaceId, reference });
}

export function cancelSubscription(workspaceId: string) {
  return invoke<{ ok: true; status: string }>("billing-actions", { action: "cancel", workspace_id: workspaceId });
}

/** Only our own reference shape is ever sent for verification. */
export function isOurReference(value: string | null): value is string {
  return !!value && /^sf_[a-f0-9]{32}$/.test(value);
}
