// System events shown inside a WhatsApp conversation, built from the
// workspace activity log (member-readable, metadata only). Unknown actions
// are hidden rather than shown as raw codes.
export type ActivityRow = {
  id: string; action: string; target_type: string | null; target_id: string | null;
  metadata: Record<string, unknown> | null; created_at: string; actor_name: string | null;
};
export type TimelineEvent = { id: string; at: string; text: string; tone: "handover" | "ai" | "crm" | "neutral" };


function reasonText(meta: Record<string, unknown> | null): string {
  const r = meta?.reason;
  if (r === "workspace_suspended") return " (workspace suspended)";
  if (r === "messaging_window_closed") return " (24-hour window closed)";
  if (r === "customer_asked_for_human_after_hours") return " after hours";
  return "";
}

export function describeActivity(a: ActivityRow): TimelineEvent | null {
  const who = a.actor_name ?? "A team member";
  const meta = a.metadata ?? {};
  const auto = meta.source === "automation";
  const base = { id: a.id, at: a.created_at };
  switch (a.action) {
    case "inbox_conversation_handoff_requested": {
      const by = String(meta.by ?? "system");
      const text = by === "ai" ? "AI requested a human handover" : by === "customer" || by === "keyword" ? `Customer asked for a person${reasonText(meta)}` : `Handed to the team${reasonText(meta)}`;
      return { ...base, text, tone: "handover" };
    }
    case "inbox_conversation_handoff_set": return { ...base, text: auto ? "Automation handed this chat to the team" : `${who} handed this chat to the team`, tone: "handover" };
    case "inbox_conversation_taken_over": return { ...base, text: `${who} took over`, tone: "handover" };
    case "inbox_conversation_assigned": return { ...base, text: auto ? "Automation assigned this chat" : `${who} assigned this chat`, tone: "handover" };
    case "inbox_conversation_reassigned": return { ...base, text: auto ? "Automation reassigned this chat" : `${who} reassigned this chat`, tone: "handover" };
    case "inbox_conversation_ai_paused": return { ...base, text: auto ? "Automation paused AI" : `${who} paused AI`, tone: "ai" };
    case "inbox_conversation_returned_to_ai": return { ...base, text: auto ? "Automation returned this chat to AI" : `${who} returned this chat to AI`, tone: "ai" };
    case "inbox_conversation_resolved": return { ...base, text: `${who} closed this conversation`, tone: "neutral" };
    case "inbox_conversation_reopened": return { ...base, text: `${who} reopened this conversation`, tone: "neutral" };
    case "inbox_conversation_priority_set": return { ...base, text: `Priority set to ${String(meta.priority ?? "normal")}`, tone: "neutral" };
    case "inbox_conversation_tag_added": return { ...base, text: `Tagged “${String(meta.tag ?? "")}”`, tone: "neutral" };
    case "inbox_conversation_customer_linked":
    case "inbox_conversation_customer_autolinked": return { ...base, text: "Linked to a customer record", tone: "crm" };
    case "inbox_conversation_customer_unlinked": return { ...base, text: "Unlinked from the customer record", tone: "crm" };
    case "lead_created": return { ...base, text: "Lead created", tone: "crm" };
    case "lead_linked_conversation": return { ...base, text: "Linked to a lead", tone: "crm" };
    case "lead_stage_changed": return { ...base, text: "Lead moved to a new pipeline stage", tone: "crm" };
    case "lead_qualification_changed": return { ...base, text: "Lead qualification updated", tone: "crm" };
    case "lead_follow_up_scheduled": return { ...base, text: "Follow-up scheduled", tone: "crm" };
    case "lead_follow_up_completed": return { ...base, text: "Follow-up completed", tone: "crm" };
    case "lead_marked_lost": return { ...base, text: "Lead marked lost", tone: "crm" };
    case "customer_created": return { ...base, text: "Converted to a customer", tone: "crm" };
    default: return null;
  }
}
