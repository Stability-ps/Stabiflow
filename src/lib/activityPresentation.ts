// Post-launch UI polish. workspace_activity_log.action is an internal
// event-taxonomy string (e.g. "pipeline_created") shared with automations
// and analytics - never renamed here (that would be a schema/taxonomy
// change, not presentation). This is a display-only mapping layer: the
// Dashboard's Recent Activity feed renders these labels, not the raw
// action string.
//
// Audited from every logActivity()/workspace_activity_log insert call
// site across supabase/functions/*/index.ts. Anything not explicitly
// listed falls back to a humanized version of the raw string (never a
// raw snake_case leak to a customer-facing surface).
const ACTIVITY_LABELS: Record<string, string> = {
  campaign_draft_created: "Campaign created",
  campaign_edited: "Campaign updated",
  campaign_published: "Campaign published",
  content_media_uploaded: "Media uploaded",
  content_platform_variant_generated: "Media variant generated",
  content_published: "Content published",
  meta_connected: "Meta connected",
  meta_disconnected: "Meta disconnected",
  whatsapp_connected: "WhatsApp connected",
  whatsapp_disconnected: "WhatsApp disconnected",
  pipeline_created: "Default pipeline created",
  pipeline_default_changed: "Default pipeline changed",
  pipeline_renamed: "Pipeline renamed",
  pipeline_stage_activated: "Pipeline stage activated",
  pipeline_stage_added: "Pipeline stage added",
  pipeline_stage_flag_changed: "Pipeline stage updated",
  pipeline_stage_renamed: "Pipeline stage renamed",
  pipeline_stages_reordered: "Pipeline stages reordered",

  lead_created: "Lead created",
  lead_linked_conversation: "Lead linked to a conversation",
  lead_marked_lost: "Lead marked as lost",
  lead_qualification_changed: "Lead qualification updated",
  lead_reopened: "Lead reopened",
  lead_stage_changed: "Lead moved to a new stage",
  create_manual: "Lead created manually",
  move_stage: "Moved to a new stage",

  opportunity_created: "Opportunity created",
  opportunity_lost: "Opportunity marked as lost",
  opportunity_reopened: "Opportunity reopened",
  opportunity_stage_changed: "Opportunity moved to a new stage",
  opportunity_won: "Opportunity won",
  create_opportunity: "Opportunity created",

  customer_created: "Customer created",
  attribution_overridden: "Attribution manually updated",
  revenue_edited: "Revenue record edited",
  revenue_recorded: "Revenue recorded",
  note_added: "Note added",
  add_note: "Note added",

  inbox_conversation_assigned: "Conversation assigned",
  inbox_conversation_reassigned: "Conversation reassigned",
  inbox_conversation_reopened: "Conversation reopened",
  inbox_conversation_resolved: "Conversation resolved",
  inbox_conversation_returned_to_ai: "Conversation returned to AI",
  inbox_internal_note_added: "Internal note added",
  inbox_staff_reply_sent: "Reply sent",
  inbox_staff_template_sent: "Template message sent",

  automation_created: "Automation created",
  automation_deleted: "Automation deleted",
  automation_updated: "Automation updated",

  content_series_activated: "Content series activated",
  content_series_schedule_recalculated: "Content schedule updated",

  integration_resource_collision_skipped: "Integration resource skipped (already connected elsewhere)",
  workspace_data_exported: "Workspace data exported",

  campaign_connection_health_checked: "Campaign connection checked",
  campaign_metrics_refreshed: "Campaign metrics refreshed",
  campaign_publish_attempted: "Campaign publish attempted",
  campaign_publish_failed: "Campaign publish failed",
  campaign_readiness_checked: "Campaign readiness checked",
};

/** Capitalizes each word of a raw snake_case action string as a safe fallback for anything not in ACTIVITY_LABELS - never leaks a raw "pipeline_created" to a customer-facing surface, even for an action type this mapping hasn't seen yet. */
function humanizeFallback(action: string): string {
  return action
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatActivityAction(action: string): string {
  return ACTIVITY_LABELS[action] ?? humanizeFallback(action);
}

const DASHBOARD_HIDDEN_ACTIONS = new Set([
  "campaign_connection_health_checked",
  "campaign_metrics_refreshed",
  "campaign_publish_attempted",
  "campaign_publish_failed",
  "campaign_readiness_checked",
  "content_series_schedule_recalculated",
  "integration_resource_collision_skipped",
  "workspace_data_exported",
]);

export function isDashboardActivity(action: string): boolean {
  return !DASHBOARD_HIDDEN_ACTIONS.has(action);
}
