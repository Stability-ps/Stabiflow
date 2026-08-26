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
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export type DeliveryTone = "healthy" | "attention" | "error" | "neutral";

export function deliveryTone(status: string | null): DeliveryTone {
  const value = (status || "").toLowerCase();
  if (value === "read" || value === "delivered") return "healthy";
  if (value === "saved_local" || value === "sending" || value === "submitted" || value === "queued") return "attention";
  if (value === "failed" || value === "error" || value === "undeliverable" || value === "rejected") return "error";
  return "neutral";
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
