import { supabase } from "@/integrations/supabase/client";

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const message = (data as { error?: string } | null)?.error || error.message || `${name} failed`;
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export type InboxAction = "assign" | "return_to_ai" | "resolve" | "reopen" | "reply" | "reply_template" | "mark_read" | "add_note";

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
