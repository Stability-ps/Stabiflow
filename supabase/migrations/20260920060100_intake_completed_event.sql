-- Phase 3 - add the conversation.intake_completed domain event to the
-- controlled taxonomy. Extends the two inline CHECK constraints from
-- 20260912060000_automation_engine_foundation.sql (Postgres auto-named
-- them <table>_<column>_check). No new event bus, no new worker: the
-- existing automations-tick matcher keys purely on
-- (workspace_id, trigger_event_type) so this event flows into the engine
-- the moment an automation selects it as its trigger.

alter table public.domain_events
  drop constraint if exists domain_events_event_type_check;
alter table public.domain_events
  add constraint domain_events_event_type_check check (event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'conversation.intake_completed',
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  ));

alter table public.automations
  drop constraint if exists automations_trigger_event_type_check;
alter table public.automations
  add constraint automations_trigger_event_type_check check (trigger_event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'conversation.intake_completed',
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  ));
