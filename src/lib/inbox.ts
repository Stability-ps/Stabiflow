import { supabase } from "@/integrations/supabase/client";

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  // Structured error bodies vary across endpoints - some (messaging window
  // closed) put the human-legible text directly in `error`; others
  // (workspaceSuspendedBody, shared across every suspension-gated
  // function) put a machine code in `error` and the human text in
  // `message`. Prefer `message` when present so a suspended-workspace
  // action never surfaces a raw code like "workspace_suspended" instead
  // of a real sentence.
  if (error) {
    const body = data as { error?: string; message?: string } | null;
    const message = body?.message || body?.error || error.message || `${name} failed`;
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    const typed = data as { error: string; message?: string };
    throw new Error(typed.message || typed.error);
  }
  return data as T;
}

export type InboxAction = "assign" | "return_to_ai" | "resolve" | "reopen" | "reply" | "reply_template" | "mark_read" | "add_note" | "retry_message";

export function runInboxAction(workspaceId: string, conversationId: string, action: InboxAction, params: Record<string, unknown> = {}) {
  return invoke<{ ok: true; delivery_status?: string; warning?: string | null }>("inbox-actions", {
    workspace_id: workspaceId,
    conversation_id: conversationId,
    action,
    ...params,
  });
}

export function assignConversation(workspaceId: string, conversationId: string, staffId: string) {
  return runInboxAction(workspaceId, conversationId, "assign", { staff_id: staffId });
}

export function returnConversationToAI(workspaceId: string, conversationId: string) {
  return runInboxAction(workspaceId, conversationId, "return_to_ai");
}

export function resolveConversation(workspaceId: string, conversationId: string) {
  return runInboxAction(workspaceId, conversationId, "resolve");
}

export function reopenConversation(workspaceId: string, conversationId: string) {
  return runInboxAction(workspaceId, conversationId, "reopen");
}

export function markConversationRead(workspaceId: string, conversationId: string) {
  return runInboxAction(workspaceId, conversationId, "mark_read");
}

export function addInternalNote(workspaceId: string, conversationId: string, note: string, mentionedStaffIds: string[] = []) {
  return runInboxAction(workspaceId, conversationId, "add_note", { note, mentioned_staff_ids: mentionedStaffIds });
}

export function replyToConversation(workspaceId: string, conversationId: string, message: string) {
  return runInboxAction(workspaceId, conversationId, "reply", { message });
}

export function replyWithTemplate(workspaceId: string, conversationId: string, templateId: string, parameters: string[]) {
  return runInboxAction(workspaceId, conversationId, "reply_template", { template_id: templateId, parameters });
}

/** Phase 9: manually retry a dead-lettered outbound message. Re-runs every
 * send safety gate against current state; never sends if delivered/read. */
export function retryOutboundMessage(workspaceId: string, conversationId: string, messageId: string) {
  return invoke<{ ok: true; outcome?: { result?: string } }>("inbox-actions", {
    workspace_id: workspaceId, conversation_id: conversationId, action: "retry_message", message_id: messageId,
  });
}
