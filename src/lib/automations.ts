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

// Kept in sync with supabase/functions/_shared/automations/taxonomy.ts - the
// server is the source of truth (CHECK constraints + isEventType/isActionType
// reject anything outside these lists); this list only drives the builder's
// dropdown options.
export const EVENT_TYPES = [
  "conversation.started", "message.received", "conversation.human_takeover",
  "lead.created", "lead.qualified", "lead.stage_changed", "lead.idle_timeout",
  "opportunity.created", "opportunity.stage_changed", "opportunity.won", "opportunity.lost",
  "customer.created", "revenue.recorded",
  "content.published", "content.publish_failed",
  "campaign.published", "campaign.paused", "campaign.performance_changed",
  "attribution.created",
  "flow_ai.analysis_completed",
] as const;
export type AutomationEventType = (typeof EVENT_TYPES)[number];

export const ACTION_TYPES = [
  "create_lead", "assign_lead", "update_lead_stage",
  "create_opportunity", "assign_opportunity",
  "create_internal_note", "create_notification", "request_flow_ai_analysis",
] as const;
export type AutomationActionType = (typeof ACTION_TYPES)[number];

export const CONDITION_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "is_null", "is_not_null"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const EVENT_TYPE_LABELS: Record<AutomationEventType, string> = {
  "conversation.started": "A WhatsApp conversation starts",
  "message.received": "A WhatsApp message is received",
  "conversation.human_takeover": "Staff takes over a conversation from AI",
  "lead.created": "A lead is created",
  "lead.qualified": "A lead is marked qualified",
  "lead.stage_changed": "A lead moves pipeline stage",
  "lead.idle_timeout": "A lead has been idle for a while",
  "opportunity.created": "An opportunity is created",
  "opportunity.stage_changed": "An opportunity moves pipeline stage",
  "opportunity.won": "An opportunity is marked won",
  "opportunity.lost": "An opportunity is marked lost",
  "customer.created": "A customer is created",
  "revenue.recorded": "Revenue is recorded",
  "content.published": "A content post is published",
  "content.publish_failed": "A content post fails to publish",
  "campaign.published": "A campaign is published",
  "campaign.paused": "A campaign is paused",
  "campaign.performance_changed": "A campaign's performance changes",
  "attribution.created": "A new attribution touchpoint is recorded",
  "flow_ai.analysis_completed": "A Flow AI analysis completes",
};

export const ACTION_TYPE_LABELS: Record<AutomationActionType, string> = {
  create_lead: "Create a lead",
  assign_lead: "Assign the lead to a staff member",
  update_lead_stage: "Move the lead to a pipeline stage",
  create_opportunity: "Create an opportunity",
  assign_opportunity: "Assign the opportunity to a staff member",
  create_internal_note: "Add an internal note",
  create_notification: "Send an in-app notification",
  request_flow_ai_analysis: "Ask Flow AI to analyze this",
};

export type AutomationConditionInput = { field: string; operator: ConditionOperator; value: unknown };
export type AutomationActionInput = { action_type: AutomationActionType; action_config: Record<string, unknown> };

function runAutomationsAction<T>(workspaceId: string, action: string, params: Record<string, unknown> = {}) {
  return invoke<T>("automations-actions", { workspace_id: workspaceId, action, ...params });
}

export function createAutomation(workspaceId: string, params: {
  name: string; triggerEventType: AutomationEventType; idleTimeoutMinutes?: number;
  conditions: AutomationConditionInput[]; actions: AutomationActionInput[];
}) {
  return runAutomationsAction<{ automation: { id: string }; created: true }>(workspaceId, "create", {
    name: params.name,
    trigger_event_type: params.triggerEventType,
    idle_timeout_minutes: params.idleTimeoutMinutes,
    conditions: params.conditions,
    actions: params.actions,
  });
}

export function updateAutomation(workspaceId: string, automationId: string, params: {
  name?: string; triggerEventType?: AutomationEventType; idleTimeoutMinutes?: number | null;
  conditions?: AutomationConditionInput[]; actions?: AutomationActionInput[];
}) {
  return runAutomationsAction<{ ok: true }>(workspaceId, "update", {
    automation_id: automationId,
    name: params.name,
    trigger_event_type: params.triggerEventType,
    idle_timeout_minutes: params.idleTimeoutMinutes,
    conditions: params.conditions,
    actions: params.actions,
  });
}

export function setAutomationStatus(workspaceId: string, automationId: string, status: "enabled" | "disabled") {
  return runAutomationsAction<{ ok: true }>(workspaceId, "set_status", { automation_id: automationId, status });
}

export function deleteAutomation(workspaceId: string, automationId: string) {
  return runAutomationsAction<{ ok: true }>(workspaceId, "delete", { automation_id: automationId });
}

export function markNotificationRead(notificationId: string) {
  return supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notificationId);
}
