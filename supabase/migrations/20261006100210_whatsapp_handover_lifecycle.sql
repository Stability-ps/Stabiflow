-- WhatsApp handover lifecycle (Acapolite-derived handover, completed for
-- StabiFlow's shared inbox + automations).
--
-- The conversation state itself is unchanged - status / ai_enabled /
-- assigned_staff_id / inbox_status already express the five handover states
-- (see src/lib/handoverState.ts). What was missing:
--
-- 1. Distinct lifecycle events. conversation.human_takeover keeps its
--    existing meaning ("handed to a human" - requested by the customer, the
--    AI, staff or an automation). New:
--      conversation.agent_took_over - a specific team member now owns it
--      conversation.ai_paused       - AI stopped without a handover
--      conversation.ai_resumed      - returned to AI / automation
--      conversation.closed          - resolved
-- 2. Automation actions for the same lifecycle: assign_conversation,
--    pause_conversation_ai, resume_conversation_ai.
-- 3. Per-workspace extra handover phrases, checked in addition to the
--    built-in multilingual detection (replyGuardrails.requestsHumanHandoff).

alter table public.domain_events drop constraint if exists domain_events_event_type_check;
alter table public.domain_events add constraint domain_events_event_type_check check (event_type = any (array[
  'conversation.started','message.received','conversation.human_takeover','conversation.intake_completed','conversation.handoff_sla_overdue',
  'conversation.document_received','conversation.ai_limit_reached','conversation.idle_timeout','conversation.priority_changed','message.delivery_failed',
  'conversation.agent_took_over','conversation.ai_paused','conversation.ai_resumed','conversation.closed',
  'lead.created','lead.qualified','lead.stage_changed','lead.idle_timeout','lead.follow_up_scheduled','lead.follow_up_completed',
  'opportunity.created','opportunity.stage_changed','opportunity.won','opportunity.lost','customer.created','revenue.recorded',
  'content.published','content.publish_failed','campaign.published','campaign.paused','campaign.performance_changed','attribution.created','flow_ai.analysis_completed'
]::text[]));

alter table public.automations drop constraint if exists automations_trigger_event_type_check;
alter table public.automations add constraint automations_trigger_event_type_check check (trigger_event_type = any (array[
  'conversation.started','message.received','conversation.human_takeover','conversation.intake_completed','conversation.handoff_sla_overdue',
  'conversation.document_received','conversation.ai_limit_reached','conversation.idle_timeout','conversation.priority_changed','message.delivery_failed',
  'conversation.agent_took_over','conversation.ai_paused','conversation.ai_resumed','conversation.closed',
  'lead.created','lead.qualified','lead.stage_changed','lead.idle_timeout','lead.follow_up_scheduled','lead.follow_up_completed',
  'opportunity.created','opportunity.stage_changed','opportunity.won','opportunity.lost','customer.created','revenue.recorded',
  'content.published','content.publish_failed','campaign.published','campaign.paused','campaign.performance_changed','attribution.created','flow_ai.analysis_completed'
]::text[]));

alter table public.automation_actions drop constraint if exists automation_actions_action_type_check;
alter table public.automation_actions add constraint automation_actions_action_type_check check (action_type in (
  'create_lead', 'assign_lead', 'update_lead_stage',
  'create_opportunity', 'assign_opportunity',
  'create_internal_note', 'create_notification', 'request_flow_ai_analysis',
  'set_conversation_priority', 'set_conversation_handoff',
  'send_whatsapp_template', 'request_document', 'add_tag',
  'assign_conversation', 'pause_conversation_ai', 'resume_conversation_ai'
));

-- Handover phrases ---------------------------------------------------------------

create or replace function public.valid_handoff_keywords(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $
  select coalesce(cardinality(p), 0) <= 25
     and not exists (select 1 from unnest(coalesce(p, '{}')) k where k is null or length(btrim(k)) < 2 or length(k) > 60);
$$;

alter table public.workspace_settings
  add column if not exists handoff_keywords text[] not null default '{}';
alter table public.workspace_settings drop constraint if exists workspace_settings_handoff_keywords_valid;
alter table public.workspace_settings add constraint workspace_settings_handoff_keywords_valid check (public.valid_handoff_keywords(handoff_keywords));

comment on column public.workspace_settings.handoff_keywords is
  'Extra phrases (case-insensitive, whole-word) that hand a WhatsApp conversation to a human, in addition to the built-in detection. Max 25, 2-60 chars each.';
