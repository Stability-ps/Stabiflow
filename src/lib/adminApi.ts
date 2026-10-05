// Client for the admin-console edge function. The function authorizes every
// call against platform_admin_roles; nothing here is a security boundary.
import { supabase } from "@/integrations/supabase/client";
import type { AdminPermission, AdminRole, ExportDataset } from "@/lib/adminPermissions";

export class AdminApiError extends Error {
  readonly status: number | null;
  readonly ref: string | null;
  constructor(message: string, status: number | null, ref: string | null) {
    super(message);
    this.status = status;
    this.ref = ref;
  }
}

async function errorBody(error: unknown): Promise<{ error?: string; ref?: string } | null> {
  const ctx = (error as { context?: { clone?: () => Response; json?: () => Promise<unknown>; status?: number } } | null)?.context;
  if (!ctx) return null;
  try {
    const res = typeof ctx.clone === "function" ? ctx.clone() : (ctx as unknown as Response);
    return (await res.json()) as { error?: string; ref?: string };
  } catch {
    return null;
  }
}

export async function adminConsole<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-console", { body: { action, ...payload } });
  if (error) {
    const body = await errorBody(error);
    const status = (error as { context?: { status?: number } }).context?.status ?? null;
    throw new AdminApiError(body?.error || "Request failed", status, body?.ref ?? null);
  }
  return data as T;
}

/** Downloads a server-generated CSV. The browser never holds more than the
 * finished file. */
export async function downloadAdminExport(dataset: ExportDataset, filters: Record<string, unknown> = {}): Promise<{ filename: string }> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new AdminApiError("Your session has expired. Sign in again.", 401, null);
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-console`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string },
    body: JSON.stringify({ action: "export", dataset, ...filters }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; ref?: string } | null;
    throw new AdminApiError(body?.error || "Export failed", res.status, body?.ref ?? null);
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `stabiflow-${dataset}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename };
}

// Response shapes ---------------------------------------------------------------------

export type AdminMe = { userId: string; role: AdminRole; permissions: AdminPermission[] };

export type CurrencyAmount = { currency: string; gross_minor: number; transactions?: number };

export type AdminOverview = {
  range: { from: string; to: string };
  users: {
    total: number; new_in_range: number; new_today: number; new_7d: number; new_30d: number;
    signed_in_1d: number; signed_in_7d: number; signed_in_30d: number; unconfirmed: number; without_workspace: number;
  };
  workspaces: { total: number; new_in_range: number; active_in_range: number; paying: number; suspended: number };
  product: {
    leads_created: number; customers_created: number; opportunities_created: number; opportunities_won: number;
    automations_active: number; automation_runs: number; automation_runs_succeeded: number; automation_runs_failed: number;
    posts_published: number; posts_failed: number; creative_concepts: number; creative_failed: number;
    website_scans: number; website_scans_failed: number; messages_in: number; messages_out: number; messages_dead_lettered: number;
    campaigns_created: number; profiles_published: number;
  };
  ai: { calls: number; succeeded: number; failed: number; tokens: number; cost_usd: number; calls_without_cost: number };
  revenue: { by_currency: CurrencyAmount[]; mrr_by_currency: { currency: string; mrr_minor: number; at_risk_minor: number; subscriptions: number }[] };
  subscriptions: { active: number; at_risk: number; started: number; cancelled: number; failed_payments: number; reversed_payments: number };
  series: { date: string; signups: number; workspaces: number; ai_calls: number; payments: number }[];
  tracking_since: { users: string | null; activity_log: string | null; ai_usage: string | null; billing: string | null };
};

export type AdminAlert = {
  id: string; severity: "critical" | "high" | "medium" | "low"; area: string; title: string; detail: string;
  at: string | null; workspace: { id: string; name: string | null } | null; href: string;
};

export type ActivityRow = { kind: string; at: string; workspace_id: string | null; workspace_name: string | null; user_id: string | null; label: string };

export type SearchResults = {
  users: { id: string; email: string; full_name: string | null }[];
  workspaces: { id: string; name: string; slug: string }[];
  transactions: { id: string; reference: string; status: string; amount_minor: number; currency: string; workspace_id: string | null; workspace_name: string | null }[];
  subscriptions: { id: string; status: string; provider_subscription_code: string | null; workspace_id: string; workspace_name: string | null }[];
};

export type Paged<T> = { total: number; rows: T[]; page: number; pageSize: number };

export type AdminUserRow = {
  id: string; email: string; full_name: string | null; created_at: string; last_sign_in_at: string | null; email_confirmed: boolean;
  admin_role: AdminRole | null; workspaces: { id: string; name: string; role: string; status: string }[];
};

export type AdminBusinessRow = {
  id: string; name: string; slug: string; created_at: string; status: string; paying: boolean; last_activity_at: string | null;
  plan_codes: string[]; members: number; owner: { id: string; email: string; full_name: string | null } | null; country_code: string | null;
  revenue: CurrencyAmount[];
};

export type AdminUserDetail = {
  id: string; email: string; full_name: string | null; created_at: string; last_sign_in_at: string | null; email_confirmed_at: string | null;
  providers: string[]; admin_role: AdminRole | null;
  workspaces: { id: string; name: string; role: string; joined_at: string; status: string; plan_codes: string[] }[];
  legal: { document_type: string; version: string; accepted_at: string }[];
  ai_30d: { calls: number; tokens: number; cost_usd: number };
  recent_activity: { action: string; target_type: string | null; created_at: string; workspace_id: string; workspace_name: string | null }[];
  admin_history: { action: string; target_type: string; reason: string | null; created_at: string; operator_name: string | null }[];
};

export type AdminBusinessDetail = {
  id: string; name: string; slug: string; created_at: string; status: string; trial_ends_at: string | null; plan_codes: string[]; paying: boolean;
  settings: { timezone: string | null; currency: string | null; industry: string | null; website: string | null } | null;
  identity: { legal_name: string | null; trading_name: string | null; country_code: string | null; industry: string | null; verification_status: string | null } | null;
  hosted_profile: { slug: string; is_published: boolean; published_at: string | null } | null;
  members: { user_id: string; email: string | null; full_name: string | null; role: string; joined_at: string; last_sign_in_at: string | null }[];
  pending_invitations: number;
  subscriptions: { id: string; status: string; plan: string | null; plan_code: string | null; amount_minor: number | null; currency: string | null; interval: string | null; provider: string; current_period_end: string | null; grace_until: string | null; cancel_at_period_end: boolean; created_at: string; cancelled_at: string | null }[];
  purchases: { id: string; status: string; plan: string | null; amount_minor: number; currency: string; paid_at: string | null; access_expires_at: string | null }[];
  transactions: AdminTransaction[];
  usage: { key: string; kind: string; enabled: boolean; limit: number | null; unlimited: boolean; used: number; source: string }[];
  integrations: { provider: string; status: string; connected_at: string | null; last_health_check_at: string | null; last_health_check_status: string | null; last_success_at: string | null; token_expires_at: string | null; webhook_subscription_status: string | null }[];
  whatsapp_numbers: { display_phone_number: string | null; verified_name: string | null; is_active: boolean; quality_rating: string | null; platform_status: string | null }[];
  modules: Record<string, number>;
  recent_activity: { action: string; target_type: string | null; created_at: string; actor_name: string | null }[];
  admin_history: { action: string; reason: string | null; created_at: string; operator_name: string | null }[];
  billing_hidden?: boolean;
};

export type AdminTransaction = {
  id: string; reference: string; provider?: string; kind: string; status: string; amount_minor: number; currency: string;
  paid_amount_minor: number | null; paid_currency: string | null; paid_at: string | null; verified_via?: string | null; failure_reason: string | null;
  created_at: string; workspace_id?: string | null; workspaces?: { name: string } | null;
  billing_prices?: { billing_interval: string; billing_plans: { name: string; code: string } | null } | null;
};

export type AdminWebhookEvent = {
  id: string; provider: string; event_type: string; signature_valid: boolean; processing_status: string; processing_result: string | null;
  received_at: string; processed_at: string | null; workspace_id: string | null; workspaces: { name: string } | null;
};

export type AdminSubscription = {
  id: string; status: string; provider: string; current_period_start: string | null; current_period_end: string | null; grace_until: string | null;
  cancel_at_period_end: boolean; cancelled_at: string | null; created_at: string; workspace_id: string; workspaces: { name: string } | null;
  billing_plans: { name: string; code: string } | null; billing_prices: { amount_minor: number; currency: string; billing_interval: string } | null;
};

export type AdminRevenue = {
  range: { from: string; to: string };
  by_currency: { currency: string; gross_minor: number | null; successful: number; paying_workspaces: number; reversed_minor: number | null; failed: number; abandoned: number }[];
  by_plan: { plan: string; plan_code: string | null; currency: string; gross_minor: number; transactions: number }[];
  by_kind: { kind: string; currency: string; gross_minor: number; transactions: number }[];
  mrr: { currency: string; mrr_minor: number; at_risk_minor: number; active: number }[];
  subscriptions: { by_status: Record<string, number>; started: number; cancelled: number; expired: number; renewals: number };
  series: { date: string; currency: string; gross_minor: number }[];
  tracking_since: string | null;
};

export type AdminAuditRow = {
  id: string; action: string; target_type: string; target_id: string | null; workspace_id: string | null; reason: string | null;
  before_state: unknown; after_state: unknown; created_at: string; operator_user_id: string;
  profiles: { full_name: string | null } | null; workspaces: { name: string } | null;
};

export type AdminStaffRow = {
  user_id: string; role: AdminRole; email: string; full_name: string | null; granted_by_name: string | null;
  created_at: string; updated_at: string; last_sign_in_at: string | null;
};
