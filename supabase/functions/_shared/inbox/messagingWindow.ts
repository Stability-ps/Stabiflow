// The ONE authoritative source for WhatsApp's 24-hour customer-service
// messaging window (Phase L-1). Every outbound free-form send path -
// staff replies (inbox-actions), AI replies (whatsapp-webhook), and any
// future dispatcher - must resolve window state through this module
// before attempting a send. Never inferred from conversation.updated_at,
// the last staff/AI message, or anything client-supplied - only a real
// inbound customer message counts, per Meta's actual policy.
//
// Pure calculation is exported separately from the DB-querying resolver
// (matching the established pattern in conditionEvaluator.ts/
// retryDecision.ts/contentPublishDecision.ts) so the boundary math is
// directly unit-testable with no database.
// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

export const MESSAGING_WINDOW_HOURS = 24;
const MESSAGING_WINDOW_MS = MESSAGING_WINDOW_HOURS * 60 * 60 * 1000;

export type MessagingWindowState = "open" | "closed" | "unknown";

// "unknown" (never "open") when there is no inbound customer message
// evidence at all, or either timestamp fails to parse - a conversation
// StabiFlow can't prove is inside the window must never be treated as
// sendable. This is the single fail-closed default the rest of the
// system relies on.
export function computeMessagingWindowState(lastCustomerMessageAtIso: string | null, nowIso: string): MessagingWindowState {
  if (!lastCustomerMessageAtIso) return "unknown";
  const last = new Date(lastCustomerMessageAtIso).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(last) || Number.isNaN(now)) return "unknown";
  return now <= last + MESSAGING_WINDOW_MS ? "open" : "closed";
}

// Queries inbox_messages directly for the most recent row with real
// inbound-customer evidence (direction='inbound' AND sender_type='customer')
// - deliberately NOT inbox_conversations.last_inbound_at, even though that
// column happens to track the same thing today. Querying the message log
// itself is the authoritative source per this phase's instructions; a
// cached column on the conversation row is a display convenience the
// frontend may still use, never the enforcement path.
export async function getLastCustomerMessageAt(sb: AnySupabaseClient, conversationId: string): Promise<string | null> {
  const { data } = await sb
    .from("inbox_messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .eq("sender_type", "customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ?? null;
}

export type MessagingWindowResult = { state: MessagingWindowState; lastCustomerMessageAt: string | null };

export async function resolveMessagingWindow(sb: AnySupabaseClient, conversationId: string, nowIso: string = new Date().toISOString()): Promise<MessagingWindowResult> {
  const lastCustomerMessageAt = await getLastCustomerMessageAt(sb, conversationId);
  return { state: computeMessagingWindowState(lastCustomerMessageAt, nowIso), lastCustomerMessageAt };
}
