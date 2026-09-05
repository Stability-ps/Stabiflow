// Phase J's controlled event/action/operator taxonomy - kept in exact sync
// with the CHECK constraints in
// 20260912060000_automation_engine_foundation.sql. Never accept an event
// type, action type, or operator from anywhere but these lists - a tenant
// (or an automation's own JSON config) never gets to invent one.
export const EVENT_TYPES = [
  "conversation.started", "message.received", "conversation.human_takeover",
  "conversation.intake_completed", "conversation.handoff_sla_overdue",
  "conversation.document_received", "conversation.ai_limit_reached",
  "conversation.idle_timeout", "conversation.priority_changed",
  "message.delivery_failed",
  "lead.created", "lead.qualified", "lead.stage_changed", "lead.idle_timeout",
  "opportunity.created", "opportunity.stage_changed", "opportunity.won", "opportunity.lost",
  "customer.created", "revenue.recorded",
  "content.published", "content.publish_failed",
  "campaign.published", "campaign.paused", "campaign.performance_changed",
  "attribution.created",
  "flow_ai.analysis_completed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ACTION_TYPES = [
  "create_lead", "assign_lead", "update_lead_stage",
  "create_opportunity", "assign_opportunity",
  "create_internal_note", "create_notification", "request_flow_ai_analysis",
  "set_conversation_priority", "set_conversation_handoff",
  "send_whatsapp_template", "request_document", "add_tag",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const CONDITION_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "is_null", "is_not_null"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}
export function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}
export function isConditionOperator(value: string): value is ConditionOperator {
  return (CONDITION_OPERATORS as readonly string[]).includes(value);
}
