// Phase 11 - WhatsApp operational analytics (frontend presentation).
// The server RPC public.get_whatsapp_operational_analytics is the ONE
// authoritative definition of every metric; this file only formats the
// already-computed values for display. No I/O, no metric logic.
//
// Core rule (inherited from Phase-1 Revenue Ops): UNKNOWN is not ZERO. A
// null median or rate means "not enough data" and must render as "-",
// never "0 min" / "0%".

export type WhatsAppOperationalAnalytics = {
  conversations_started: number;
  inbound_messages: number;
  median_human_response_seconds: number | null;
  human_response_sample_size: number;
  conversations_with_handoff: number;
  handoff_rate: number | null;
  median_resolution_seconds: number | null;
  conversations_resolved: number;
  intake_applicable: number;
  intake_completed: number;
  intake_completion_rate: number | null;
  handled_ai_only: number;
  handled_human_assisted: number;
  handled_human_only: number;
  handled_no_agent_reply: number;
};

export const HANDLING_LABELS = {
  handled_ai_only: "AI only",
  handled_human_assisted: "Human-assisted",
  handled_human_only: "Human only",
  handled_no_agent_reply: "Awaiting first reply",
} as const;

export type HandlingKey = keyof typeof HANDLING_LABELS;

/** A compact "3m 12s" / "1h 4m" / "8s" duration, or the honest unknown
 * dash when the server returned null (no measurable sample). */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${h}h ${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

/** A rate in [0,1] as a whole-number percent, or "N/A" when the server
 * returned null (denominator was zero - not a measured 0%). */
export function formatRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "N/A";
  return `${Math.round(rate * 100)}%`;
}

export type DeltaDirection = "up" | "down" | "flat" | "none";

/** Signed change vs the previous equal-length period, for a KPI card
 * subline. Returns direction + a formatted magnitude; "none" when either
 * side is unknown (never a misleading "+100%"). */
export function periodDelta(current: number | null | undefined, previous: number | null | undefined): { direction: DeltaDirection; label: string } {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { direction: "none", label: "" };
  }
  const diff = current - previous;
  if (diff === 0) return { direction: "flat", label: "no change" };
  return { direction: diff > 0 ? "up" : "down", label: `${diff > 0 ? "+" : ""}${diff}` };
}

/** Percent-point (not relative) delta for a rate metric, vs previous
 * period. "none" when either side is unknown. */
export function ratePointDelta(current: number | null | undefined, previous: number | null | undefined): { direction: DeltaDirection; label: string } {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { direction: "none", label: "" };
  }
  const pts = Math.round((current - previous) * 100);
  if (pts === 0) return { direction: "flat", label: "no change" };
  return { direction: pts > 0 ? "up" : "down", label: `${pts > 0 ? "+" : ""}${pts} pts` };
}

/** True when the workspace has genuinely no WhatsApp conversation data in
 * the selected period - the page shows an empty state instead of a wall of
 * zeros. */
export function isEmptyAnalytics(a: WhatsAppOperationalAnalytics | null | undefined): boolean {
  return !a || a.conversations_started === 0;
}

export function handlingBreakdown(a: WhatsAppOperationalAnalytics): Array<{ key: HandlingKey; label: string; count: number; pct: number }> {
  const total = a.handled_ai_only + a.handled_human_assisted + a.handled_human_only + a.handled_no_agent_reply;
  return (Object.keys(HANDLING_LABELS) as HandlingKey[]).map((key) => {
    const count = a[key];
    return { key, label: HANDLING_LABELS[key], count, pct: total > 0 ? count / total : 0 };
  });
}
