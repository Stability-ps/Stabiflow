// Phase 5 - WhatsApp handoff SLA. The PURE statement of the SLA lifecycle
// for a single conversation, mirrored by the sla_sweep() SQL (raise/resolve
// predicates) and by src/lib/slaState.ts (UI). No I/O.
//
// SLA start           = human_handoff_requested_at, only while the
//                       conversation still needs a human.
// Qualifying response = a STAFF reply after the handoff started
//                       (last_staff_reply_at >= human_handoff_requested_at).
//                       Assignment alone is NOT a response.

export type SlaConversation = {
  status: string;               // 'active' | 'human_handoff' | 'closed'
  ai_enabled: boolean;
  inbox_status: string;         // ... | 'resolved'
  human_handoff_requested_at: string | null;
  last_staff_reply_at: string | null;
  assigned_staff_id?: string | null;
  assigned_staff_name?: string | null;
};

export type SlaSettings = { handoff_sla_minutes: number; handoff_sla_enabled: boolean };

export type SlaPhase = "not_applicable" | "waiting" | "due_soon" | "overdue";

export type SlaState = {
  applicable: boolean;
  phase: SlaPhase;
  /** ISO - when the SLA clock started (human_handoff_requested_at), or null. */
  startedAt: string | null;
  /** ISO - when it is/was due, or null. */
  dueAt: string | null;
  /** whole minutes until due (negative once overdue), or null. */
  minutesRemaining: number | null;
  /** whole minutes overdue (0 until overdue), 0 when N/A. */
  minutesOverdue: number;
  /** a qualifying staff response has already stopped the clock. */
  responded: boolean;
};

const NOT_APPLICABLE: SlaState = {
  applicable: false, phase: "not_applicable", startedAt: null, dueAt: null,
  minutesRemaining: null, minutesOverdue: 0, responded: false,
};

/** `nowMs` defaults to Date.now(); pass it explicitly in tests. */
export function computeSlaState(conv: SlaConversation, settings: SlaSettings | null | undefined, nowMs: number = Date.now()): SlaState {
  if (!settings || !settings.handoff_sla_enabled) return NOT_APPLICABLE;
  if (conv.status !== "human_handoff" || conv.ai_enabled || conv.inbox_status === "resolved") return NOT_APPLICABLE;
  if (!conv.human_handoff_requested_at) return NOT_APPLICABLE;

  const startMs = new Date(conv.human_handoff_requested_at).getTime();
  if (!Number.isFinite(startMs)) return NOT_APPLICABLE;

  const responded = conv.last_staff_reply_at != null
    && new Date(conv.last_staff_reply_at).getTime() >= startMs;
  if (responded) return { ...NOT_APPLICABLE, responded: true, startedAt: conv.human_handoff_requested_at };

  const minutes = Math.max(1, Math.min(1440, Math.trunc(settings.handoff_sla_minutes)));
  const dueMs = startMs + minutes * 60_000;
  const remainingMin = Math.floor((dueMs - nowMs) / 60_000);
  const overdueMin = remainingMin < 0 ? -remainingMin : 0;

  // "due soon" once within 20% of the threshold (min 1, max 5 minutes).
  const soonWindow = Math.max(1, Math.min(5, Math.round(minutes * 0.2)));
  const phase: SlaPhase = remainingMin < 0 ? "overdue"
    : remainingMin <= soonWindow ? "due_soon"
    : "waiting";

  return {
    applicable: true,
    phase,
    startedAt: conv.human_handoff_requested_at,
    dueAt: new Date(dueMs).toISOString(),
    minutesRemaining: remainingMin,
    minutesOverdue: overdueMin,
    responded: false,
  };
}
