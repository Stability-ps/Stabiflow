// The five-plus-one handover states, DERIVED from the columns the Acapolite-
// derived pipeline already maintains (status, ai_enabled, assigned_staff_id,
// inbox_status). There is deliberately no separate state column: one source
// of truth means the webhook's "AI stays silent" gate, the inbox UI and
// automations can never disagree. Pure module - shared by edge functions and
// the web app (src/lib/handoverState.ts re-exports it).

export type HandoverState = "bot_active" | "handover_requested" | "human_active" | "bot_paused" | "closed";

export type HandoverInput = {
  status?: string | null;
  ai_enabled?: boolean | null;
  assigned_staff_id?: string | null;
  inbox_status?: string | null;
};

export function handoverState(c: HandoverInput): HandoverState {
  if (c.inbox_status === "resolved" || c.status === "closed") return "closed";
  if (c.status === "human_handoff") return c.assigned_staff_id ? "human_active" : "handover_requested";
  if (c.ai_enabled === false) return "bot_paused";
  return "bot_active";
}

/** True when the AI is allowed to send an automatic reply. Mirrors the
 * whatsapp-webhook gate exactly; human_active and bot_paused never reply. */
export function aiMayReply(c: HandoverInput): boolean {
  return handoverState(c) === "bot_active";
}

export const HANDOVER_LABELS: Record<HandoverState, { label: string; description: string }> = {
  bot_active: { label: "AI handling", description: "AI and automations may reply." },
  handover_requested: { label: "Needs human", description: "Waiting for a team member to take over. AI is silent." },
  human_active: { label: "Human", description: "A team member owns this conversation. AI never replies automatically." },
  bot_paused: { label: "AI paused", description: "AI is switched off for this conversation, without a handover." },
  closed: { label: "Closed", description: "Resolved. A new customer message reopens it for the team." },
};
