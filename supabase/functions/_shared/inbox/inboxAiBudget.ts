// Phase 7 - Inbox AI cost governance. The PURE rules for the per-workspace
// monthly WhatsApp Inbox AI token allowance. No I/O - the webhook wires
// these to the existing ai_usage_events ledger and workspace_billing.limits
// jsonb. Mirrored by src/lib/inboxAiBudget.ts (Settings card).
//
// Contract (deliberately identical to Flow AI's, see
// supabase/functions/flow-ai-chat/index.ts):
//   * period    = UTC calendar month, [1st 00:00:00Z, next 1st 00:00:00Z)
//   * usage     = sum(ai_usage_events.total_tokens) for this workspace,
//                 feature = 'whatsapp_inbox_ai', created_at >= period start.
//                 The ledger is authoritative - there is NO second counter.
//   * cap       = workspace_billing.limits->>'whatsapp_inbox_ai_monthly_token_limit'
//                 || env FLOW_AI_DEFAULT_WORKSPACE_MONTHLY_TOKEN_LIMIT
//                 || HARD_FALLBACK. NULL/absent = "use the default".
//   * decision  = SOFT ceiling: used >= cap -> block the NEXT call. It is
//                 checked-then-called, not a transactional reservation, so
//                 N messages arriving concurrently while exactly at the cap
//                 can overshoot by up to (N-1) x one call's tokens. In
//                 practice the webhook processes a conversation's turns
//                 serially and the cap is a monthly budget, so the overshoot
//                 is a few thousand tokens at most - the same bounded
//                 imprecision Flow AI already accepts. Not claimed as strict.

export const INBOX_AI_FEATURE = "whatsapp_inbox_ai";
export const INBOX_AI_CAP_KEY = "whatsapp_inbox_ai_monthly_token_limit";

/** Positive, and far below bigint overflow - the same bound the
 * set_workspace_inbox_ai_cap RPC enforces. */
export const INBOX_AI_CAP_MIN = 1;
export const INBOX_AI_CAP_MAX = 1_099_511_627_776; // 2^40

/** Last-resort default when neither the workspace override nor the env
 * default is usable - matches flow-ai-chat's
 * DEFAULT_WORKSPACE_MONTHLY_TOKEN_LIMIT_FALLBACK. */
export const INBOX_AI_CAP_HARD_FALLBACK = 500_000;

/** UTC calendar month start - identical to flow-ai-chat startOfMonthIso(). */
export function utcMonthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** UTC day start - identical to flow-ai-chat startOfDayIso(). */
export function utcDayStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function toPositiveInt(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < INBOX_AI_CAP_MIN || n > INBOX_AI_CAP_MAX) return null;
  return n;
}

/** true when a value is an acceptable explicit cap, OR null (= use default). */
export function isValidInboxAiCap(v: unknown): boolean {
  return v === null || v === undefined || toPositiveInt(v) !== null;
}

/** Resolve the effective cap: explicit workspace override, else the env
 * default, else the hard fallback. Any unusable value is skipped, never
 * treated as "unlimited". */
export function resolveInboxAiCap(
  billingLimitRaw: unknown,
  envDefaultRaw: string | undefined | null,
  hardFallback: number = INBOX_AI_CAP_HARD_FALLBACK,
): number {
  return toPositiveInt(billingLimitRaw) ?? toPositiveInt(envDefaultRaw) ?? hardFallback;
}

export type InboxAiBudgetDecision =
  | { allowed: true }
  | { allowed: false; scope: "workspace_cap" | "platform_ceiling" };

/** The whole gate, pure. `platformUsed`/`platformCeiling` may be null when
 * the platform ceiling is not configured - then only the workspace cap
 * applies (exactly Flow AI's behaviour). */
export function decideInboxAiBudget(args: {
  workspaceUsed: number;
  workspaceCap: number;
  platformUsed?: number | null;
  platformCeiling?: number | null;
}): InboxAiBudgetDecision {
  if (args.workspaceUsed >= args.workspaceCap) return { allowed: false, scope: "workspace_cap" };
  if (
    typeof args.platformCeiling === "number" && args.platformCeiling > 0 &&
    typeof args.platformUsed === "number" && args.platformUsed >= args.platformCeiling
  ) {
    return { allowed: false, scope: "platform_ceiling" };
  }
  return { allowed: true };
}

/** The honest staff-facing reason for an AI-limit pause - never "AI error",
 * never a token number, never a platform-usage hint. */
export function inboxAiPauseReason(scope: "workspace_cap" | "platform_ceiling"): string {
  return scope === "workspace_cap"
    ? "AI paused - this workspace has reached its monthly Inbox AI usage limit. New messages are handed to staff."
    : "AI paused - Inbox AI is temporarily unavailable. New messages are handed to staff.";
}
