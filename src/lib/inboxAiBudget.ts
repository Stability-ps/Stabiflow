// Phase 7 - Inbox AI cost governance (frontend mirror). The webhook +
// supabase/functions/_shared/inbox/inboxAiBudget.ts is the source of truth;
// this only powers the compact Settings usage card. Kept in lockstep with
// the Deno constants and cap-resolution rule. No I/O.

export const INBOX_AI_FEATURE = "whatsapp_inbox_ai";
export const INBOX_AI_CAP_KEY = "whatsapp_inbox_ai_monthly_token_limit";
export const INBOX_AI_CAP_MIN = 1;
export const INBOX_AI_CAP_MAX = 1_099_511_627_776; // 2^40
export const INBOX_AI_CAP_HARD_FALLBACK = 500_000;

/** UTC calendar month start - the same period rule enforcement uses. */
export function utcMonthStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function toPositiveInt(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < INBOX_AI_CAP_MIN || n > INBOX_AI_CAP_MAX) return null;
  return n;
}

/** null/undefined (= use default) or a positive integer within bounds. */
export function isValidInboxAiCap(v: unknown): boolean {
  return v === null || v === undefined || toPositiveInt(v) !== null;
}

/** Explicit workspace override, else the platform/env default, else the
 * hard fallback. Never treats an unusable value as "unlimited". */
export function resolveInboxAiCap(
  billingLimitRaw: unknown,
  envDefaultRaw: string | number | undefined | null,
  hardFallback: number = INBOX_AI_CAP_HARD_FALLBACK,
): number {
  return toPositiveInt(billingLimitRaw) ?? toPositiveInt(envDefaultRaw) ?? hardFallback;
}

export function usagePercent(used: number, cap: number): number {
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / cap) * 100)));
}
