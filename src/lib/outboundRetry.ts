// Phase 9 - WhatsApp outbound retry (frontend UX mirror). The webhook +
// supabase/functions/_shared/inbox/outboundRetry.ts is the source of truth;
// this only turns the persisted delivery/retry columns into an honest chat
// label and decides whether a Retry control should appear. No I/O.

export type OutboundRetryFields = {
  direction: "inbound" | "outbound";
  delivery_status: string | null;
  next_retry_at: string | null;
  dead_lettered_at: string | null;
  retry_count: number | null;
};

export type OutboundDeliveryState =
  | "sending" | "sent" | "delivered" | "read"
  | "retry_scheduled" | "delivery_failed" | "not_applicable";

/** Honest per-message delivery state. delivery_status stays "failed" while a
 * retry is pending - next_retry_at / dead_lettered_at disambiguate. */
export function outboundDeliveryState(m: OutboundRetryFields): OutboundDeliveryState {
  if (m.direction !== "outbound") return "not_applicable";
  const s = (m.delivery_status || "").toLowerCase();
  if (s === "read" || s === "delivered" || s === "sent") return s as OutboundDeliveryState;
  if (s === "submitted" || s === "sending" || s === "queued") return "sending";
  if (s === "failed") {
    if (m.dead_lettered_at) return "delivery_failed";
    if (m.next_retry_at) return "retry_scheduled";
    return "delivery_failed";
  }
  return "not_applicable";
}

export function outboundDeliveryLabel(m: OutboundRetryFields): string {
  switch (outboundDeliveryState(m)) {
    case "sending": return "Sending";
    case "sent": return "Sent";
    case "delivered": return "Delivered";
    case "read": return "Read";
    case "retry_scheduled": return "Retry scheduled";
    case "delivery_failed":
      return m.dead_lettered_at
        ? `Delivery failed · ${(m.retry_count ?? 0) + 1} attempt${(m.retry_count ?? 0) + 1 === 1 ? "" : "s"}`
        : "Delivery failed";
    default: return "";
  }
}

/** A Retry control only makes sense on a dead-lettered message (StabiFlow
 * has stopped trying) for a viewer who holds inbox.manage. */
export function canRetryOutbound(m: OutboundRetryFields, canManageInbox: boolean): boolean {
  return canManageInbox && m.direction === "outbound" && !!m.dead_lettered_at;
}
