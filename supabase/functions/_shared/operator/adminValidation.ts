// Pure input validation for operator-admin actions. Every mutation the
// Admin dashboard can make is validated here BEFORE any database write, so
// a malformed request never reaches the catalogue tables. Returns either a
// clean payload or a human-readable error.

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const CODE_RE = /^[a-z0-9_]{2,40}$/;
const KEY_RE = /^[a-z0-9_.]{2,80}$/;
const PLAN_CODE_RE = /^PLN_[A-Za-z0-9]+$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function reasonOf(v: unknown): Result<string> {
  const r = text(v, 500);
  return r && r.length >= 3 ? { ok: true, value: r } : { ok: false, error: "A reason (at least 3 characters) is required" };
}

export type PlanInput = {
  code: string;
  name: string;
  description: string | null;
  plan_kind: "free" | "one_off" | "subscription";
  tier_rank: number;
  is_public: boolean;
  is_active: boolean;
  sort_order: number;
  marketing: { features: string[]; cta: string | null; badge: string | null };
};

export function validatePlan(input: unknown): Result<PlanInput> {
  if (!isObj(input)) return { ok: false, error: "Plan is required" };
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!CODE_RE.test(code)) return { ok: false, error: "Plan code must be 2-40 lowercase letters, digits or underscores" };
  const name = text(input.name, 120);
  if (!name) return { ok: false, error: "Plan name is required" };
  const kind = input.plan_kind;
  if (kind !== "free" && kind !== "one_off" && kind !== "subscription") return { ok: false, error: "Invalid plan type" };
  const m = isObj(input.marketing) ? input.marketing : {};
  const features = Array.isArray(m.features) ? m.features.map((f) => text(f, 160)).filter((f): f is string => !!f).slice(0, 20) : [];
  return {
    ok: true,
    value: {
      code,
      name,
      description: text(input.description, 2000),
      plan_kind: kind,
      tier_rank: int(input.tier_rank) ?? 0,
      is_public: input.is_public !== false,
      is_active: input.is_active !== false,
      sort_order: int(input.sort_order) ?? 0,
      marketing: { features, cta: text(m.cta, 40), badge: text(m.badge, 40) },
    },
  };
}

export type PriceInput = {
  plan_id: string;
  currency: string;
  amount_minor: number;
  billing_interval: "once" | "month" | "year";
  access_days: number | null;
  paystack_plan_code: string | null;
};

export function validatePrice(input: unknown): Result<PriceInput> {
  if (!isObj(input)) return { ok: false, error: "Price is required" };
  if (!isUuid(input.plan_id)) return { ok: false, error: "plan_id is required" };
  const amount = int(input.amount_minor);
  if (amount === null || amount < 0 || amount > 100_000_000_00) return { ok: false, error: "Amount must be a whole number of cents" };
  const interval = input.billing_interval;
  if (interval !== "once" && interval !== "month" && interval !== "year") return { ok: false, error: "Interval must be once, month or year" };
  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "ZAR";
  if (!CURRENCY_RE.test(currency)) return { ok: false, error: "Currency must be a 3-letter code" };
  const accessDays = input.access_days === null || input.access_days === undefined || input.access_days === "" ? null : int(input.access_days);
  if (accessDays !== null && (accessDays <= 0 || interval !== "once")) return { ok: false, error: "Access days apply only to once-off prices and must be positive" };
  const planCode = text(input.paystack_plan_code, 60);
  if (planCode && !PLAN_CODE_RE.test(planCode)) return { ok: false, error: "Paystack plan code must look like PLN_xxxx" };
  if (planCode && interval === "once") return { ok: false, error: "Once-off prices do not use a Paystack plan" };
  return { ok: true, value: { plan_id: input.plan_id, currency, amount_minor: amount, billing_interval: interval, access_days: accessDays, paystack_plan_code: planCode } };
}

export function validatePriceUpdate(input: unknown): Result<{ is_active?: boolean; paystack_plan_code?: string | null }> {
  if (!isObj(input)) return { ok: false, error: "Update is required" };
  const out: { is_active?: boolean; paystack_plan_code?: string | null } = {};
  if (typeof input.is_active === "boolean") out.is_active = input.is_active;
  if ("paystack_plan_code" in input) {
    const code = text(input.paystack_plan_code, 60);
    if (code && !PLAN_CODE_RE.test(code)) return { ok: false, error: "Paystack plan code must look like PLN_xxxx" };
    out.paystack_plan_code = code;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "Nothing to update (price amounts are immutable - create a new price)" };
  return { ok: true, value: out };
}

export function validatePlanEntitlement(input: unknown): Result<{ plan_id: string; entitlement_key: string; bool_value: boolean | null; limit_value: number | null }> {
  if (!isObj(input)) return { ok: false, error: "Entitlement is required" };
  if (!isUuid(input.plan_id)) return { ok: false, error: "plan_id is required" };
  const key = typeof input.entitlement_key === "string" ? input.entitlement_key : "";
  if (!KEY_RE.test(key)) return { ok: false, error: "Invalid entitlement key" };
  const bool = typeof input.bool_value === "boolean" ? input.bool_value : null;
  const limit = input.limit_value === null || input.limit_value === undefined || input.limit_value === "" ? null : int(input.limit_value);
  if (limit !== null && limit < 0) return { ok: false, error: "Limit cannot be negative" };
  if (input.limit_value !== null && input.limit_value !== undefined && input.limit_value !== "" && limit === null) return { ok: false, error: "Limit must be a whole number (leave empty for unlimited)" };
  return { ok: true, value: { plan_id: input.plan_id, entitlement_key: key, bool_value: bool, limit_value: limit } };
}

export type FlagUpdate = { is_enabled?: boolean; audience?: "everyone" | "operators" | "targeted"; plan_codes?: string[]; rollout_percentage?: number; description?: string | null };

export function validateFlagUpdate(input: unknown): Result<FlagUpdate> {
  if (!isObj(input)) return { ok: false, error: "Update is required" };
  const out: FlagUpdate = {};
  if (typeof input.is_enabled === "boolean") out.is_enabled = input.is_enabled;
  if (input.audience !== undefined) {
    if (input.audience !== "everyone" && input.audience !== "operators" && input.audience !== "targeted") return { ok: false, error: "Invalid audience" };
    out.audience = input.audience;
  }
  if (input.plan_codes !== undefined) {
    if (!Array.isArray(input.plan_codes) || input.plan_codes.some((c) => typeof c !== "string" || !CODE_RE.test(c))) return { ok: false, error: "Invalid plan codes" };
    out.plan_codes = [...new Set(input.plan_codes as string[])];
  }
  if (input.rollout_percentage !== undefined) {
    const pct = int(input.rollout_percentage);
    if (pct === null || pct < 0 || pct > 100) return { ok: false, error: "Rollout must be 0-100" };
    out.rollout_percentage = pct;
  }
  if (input.description !== undefined) out.description = text(input.description, 1000);
  if (Object.keys(out).length === 0) return { ok: false, error: "Nothing to update" };
  return { ok: true, value: out };
}

/** Settings are non-secret configuration. Keys that look like credentials are refused outright. */
export function validateSettingUpdate(input: unknown): Result<{ key: string; value: unknown }> {
  if (!isObj(input)) return { ok: false, error: "Setting is required" };
  const key = typeof input.key === "string" ? input.key : "";
  if (!KEY_RE.test(key)) return { ok: false, error: "Invalid setting key" };
  if (/(secret|password|token|api_?key|private)/i.test(key)) return { ok: false, error: "Secrets cannot be stored in platform settings" };
  if (!("value" in input) || input.value === undefined) return { ok: false, error: "A value is required" };
  const serialized = JSON.stringify(input.value);
  if (serialized.length > 20_000) return { ok: false, error: "Setting value is too large" };
  return { ok: true, value: { key, value: input.value } };
}

export function validateOverride(input: unknown): Result<{ workspace_id: string; entitlement_key: string; bool_value: boolean | null; limit_value: number | null; expires_at: string | null }> {
  if (!isObj(input)) return { ok: false, error: "Override is required" };
  if (!isUuid(input.workspace_id)) return { ok: false, error: "workspace_id is required" };
  const key = typeof input.entitlement_key === "string" ? input.entitlement_key : "";
  if (!KEY_RE.test(key)) return { ok: false, error: "Invalid entitlement key" };
  const bool = typeof input.bool_value === "boolean" ? input.bool_value : null;
  const limit = input.limit_value === null || input.limit_value === undefined || input.limit_value === "" ? null : int(input.limit_value);
  if (limit !== null && limit < 0) return { ok: false, error: "Limit cannot be negative" };
  let expires: string | null = null;
  if (input.expires_at) {
    const t = Date.parse(String(input.expires_at));
    if (!Number.isFinite(t) || t <= Date.now()) return { ok: false, error: "Expiry must be a future date" };
    expires = new Date(t).toISOString();
  }
  return { ok: true, value: { workspace_id: input.workspace_id, entitlement_key: key, bool_value: bool, limit_value: limit, expires_at: expires } };
}

/**
 * Secrets the platform depends on, reported to Admin as configured/missing
 * ONLY. The value is never read into a response.
 */
export const PLATFORM_SECRETS: { name: string; area: string; required: boolean }[] = [
  { name: "PAYSTACK_SECRET_KEY", area: "Payments", required: true },
  { name: "APP_BASE_URL", area: "Payments", required: true },
  { name: "BILLING_CRON_SECRET", area: "Payments", required: true },
  { name: "OPENAI_API_KEY", area: "AI", required: true },
  { name: "INTEGRATIONS_META_APP_ID", area: "Meta / WhatsApp", required: false },
  { name: "INTEGRATIONS_META_APP_SECRET", area: "Meta / WhatsApp", required: false },
  { name: "INTEGRATIONS_META_OAUTH_REDIRECT_URI", area: "Meta / WhatsApp", required: false },
  { name: "WHATSAPP_WEBHOOK_VERIFY_TOKEN", area: "Meta / WhatsApp", required: false },
  { name: "AUTOMATIONS_CRON_SECRET", area: "Automations", required: false },
  { name: "CONTENT_CRON_SECRET", area: "Content", required: false },
  { name: "AD_METRICS_CRON_SECRET", area: "Campaigns", required: false },
  { name: "WHATSAPP_SLA_CRON_SECRET", area: "Meta / WhatsApp", required: false },
  { name: "WHATSAPP_RETRY_CRON_SECRET", area: "Meta / WhatsApp", required: false },
];

export function secretStatus(get: (name: string) => string | undefined) {
  return PLATFORM_SECRETS.map((s) => ({ ...s, configured: !!get(s.name)?.trim() }));
}

export const LEGAL_DOCUMENT_TYPES = [
  "privacy_policy", "terms_of_service", "cookie_policy", "refund_policy", "subscription_terms", "ai_data_disclosure", "data_deletion",
] as const;

export type LegalDraftInput = {
  id: string | null;
  document_type: (typeof LEGAL_DOCUMENT_TYPES)[number];
  version: string;
  title: string;
  body: string;
  change_summary: string | null;
  effective_at: string;
};

export function validateLegalDraft(input: unknown): Result<LegalDraftInput> {
  if (!isObj(input)) return { ok: false, error: "Document is required" };
  const type = input.document_type;
  if (typeof type !== "string" || !(LEGAL_DOCUMENT_TYPES as readonly string[]).includes(type)) return { ok: false, error: "Unknown document type" };
  const version = typeof input.version === "string" ? input.version.trim() : "";
  if (!/^[0-9A-Za-z._-]{1,40}$/.test(version)) return { ok: false, error: "Version must be letters, numbers, dots or dashes (e.g. 2026-10-15)" };
  const title = text(input.title, 200);
  if (!title) return { ok: false, error: "Title is required" };
  const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n").trim() : "";
  if (body.length < 20) return { ok: false, error: "The document text is too short" };
  if (body.length > 200_000) return { ok: false, error: "The document text is too long" };
  const t = Date.parse(String(input.effective_at ?? ""));
  if (!Number.isFinite(t)) return { ok: false, error: "Effective date is required" };
  return {
    ok: true,
    value: {
      id: isUuid(input.id) ? input.id : null,
      document_type: type as LegalDraftInput["document_type"],
      version,
      title,
      body,
      change_summary: text(input.change_summary, 1000),
      effective_at: new Date(t).toISOString(),
    },
  };
}
