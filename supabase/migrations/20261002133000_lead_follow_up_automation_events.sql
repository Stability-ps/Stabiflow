alter table public.domain_events drop constraint if exists domain_events_event_type_check;
alter table public.domain_events add constraint domain_events_event_type_check check (event_type = any (array[
'conversation.started','message.received','conversation.human_takeover','conversation.intake_completed','conversation.handoff_sla_overdue','conversation.document_received','conversation.ai_limit_reached','conversation.idle_timeout','conversation.priority_changed','message.delivery_failed',
'lead.created','lead.qualified','lead.stage_changed','lead.idle_timeout','lead.follow_up_scheduled','lead.follow_up_completed',
'opportunity.created','opportunity.stage_changed','opportunity.won','opportunity.lost','customer.created','revenue.recorded',
'content.published','content.publish_failed','campaign.published','campaign.paused','campaign.performance_changed','attribution.created','flow_ai.analysis_completed'
]::text[]));

alter table public.automations drop constraint if exists automations_trigger_event_type_check;
alter table public.automations add constraint automations_trigger_event_type_check check (trigger_event_type = any (array[
'conversation.started','message.received','conversation.human_takeover','conversation.intake_completed','conversation.handoff_sla_overdue','conversation.document_received','conversation.ai_limit_reached','conversation.idle_timeout','conversation.priority_changed','message.delivery_failed',
'lead.created','lead.qualified','lead.stage_changed','lead.idle_timeout','lead.follow_up_scheduled','lead.follow_up_completed',
'opportunity.created','opportunity.stage_changed','opportunity.won','opportunity.lost','customer.created','revenue.recorded',
'content.published','content.publish_failed','campaign.published','campaign.paused','campaign.performance_changed','attribution.created','flow_ai.analysis_completed'
]::text[]));