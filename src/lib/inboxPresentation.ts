// Presentation helpers for the Inbox UI (Phase D). Adapted from Acapolite's
// AdminWhatsAppQA.tsx aiHumanStatusText()/delivery-label/delivery-tone
// helpers - genuinely tenant-agnostic UI text logic, ported near-verbatim.

export function aiHumanStatusText(conversation: { ai_enabled: boolean; assigned_staff_name: string | null }): string {
  return conversation.ai_enabled
    ? "AI is active. Take over or assign the chat before replying."
    : `Human control is active${conversation.assigned_staff_name ? `, assigned to ${conversation.assigned_staff_name}` : ""}. AI replies are locked.`;
}

export function deliveryLabel(status: string | null): string {
  if (!status) return "";
  if (status === "saved_local") return "Saved in StabiFlow";
  if (status === "blocked_window_closed") return "Not sent - messaging window closed";
  if (status === "blocked_workspace_suspended") return "Not sent - workspace suspended";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export type DeliveryTone = "healthy" | "attention" | "error" | "neutral";

export function deliveryTone(status: string | null): DeliveryTone {
  const value = (status || "").toLowerCase();
  if (value === "read" || value === "delivered") return "healthy";
  if (value === "saved_local" || value === "sending" || value === "submitted" || value === "queued") return "attention";
  if (value === "failed" || value === "error" || value === "undeliverable" || value === "rejected" || value === "blocked_window_closed" || value === "blocked_workspace_suspended") return "error";
  return "neutral";
}

// Phase L-1: WhatsApp's 24-hour customer-service messaging window - the
// SAME calculation as the authoritative server-side helper
// (supabase/functions/_shared/inbox/messagingWindow.ts), kept as a
// separate, parallel implementation per this codebase's established
// convention (see _shared/integration-providers/types.ts's header comment:
// "parallel, not shared" between frontend and edge-function code).
//
// This is a DISPLAY-ONLY convenience, driven by the already-fetched
// conversation.last_inbound_at column - never the enforcement path. The
// browser is not the security boundary; every actual send is re-checked
// server-side against the real inbox_messages log regardless of what this
// returns. Safe to use for the UI indicator precisely because nothing
// bad happens if it's ever stale by a few seconds - the server call would
// simply reject the send with a clear error.
export const MESSAGING_WINDOW_HOURS = 24;

export type MessagingWindowState = "open" | "closed" | "unknown";

export function computeMessagingWindowState(lastInboundAt: string | null, now: Date = new Date()): MessagingWindowState {
  if (!lastInboundAt) return "unknown";
  const last = new Date(lastInboundAt).getTime();
  if (Number.isNaN(last)) return "unknown";
  return now.getTime() <= last + MESSAGING_WINDOW_HOURS * 60 * 60 * 1000 ? "open" : "closed";
}

export function messagingWindowLabel(state: MessagingWindowState): string {
  if (state === "open") return "Messaging window open";
  if (state === "closed") return "24-hour window closed";
  return "Messaging window unknown";
}

export function inboxStatusLabel(status: string): string {
  const labels: Record<string, string> = { new: "New", unassigned: "Unassigned", assigned: "Assigned", waiting_client: "Waiting on client", resolved: "Resolved" };
  return labels[status] || status;
}

export function priorityLabel(priority: string): string {
  const labels: Record<string, string> = { normal: "Normal", high: "High", urgent: "Urgent" };
  return labels[priority] || priority;
}

// "Ask missing info" (instruction: reuse this exact mechanism) - a pure
// client-side canned-reply builder, NOT an AI call. Reads
// intake_missing_fields + intake_payload and composes a short "here's what
// we still need" message for staff to review/edit/send through the normal
// reply action - matches the source implementation's buildWhatsAppMissingInfoReply().
const FIELD_QUESTIONS: Record<string, string> = {
  customer_name: "your full name",
  email: "an email address we can use",
  interest_summary: "a bit more detail on what you're looking for",
};

export function buildMissingInfoReply(missingFields: string[]): string {
  if (!missingFields.length) return "";
  const asked = missingFields.map((field) => FIELD_QUESTIONS[field] || field).filter(Boolean);
  if (!asked.length) return "";
  if (asked.length === 1) return `Thanks for reaching out! Could you share ${asked[0]}?`;
  const last = asked[asked.length - 1];
  const rest = asked.slice(0, -1).join(", ");
  return `Thanks for reaching out! Could you share ${rest} and ${last}?`;
}
