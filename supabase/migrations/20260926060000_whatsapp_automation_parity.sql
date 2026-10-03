-- Phase 8 - WhatsApp automation parity.
--
-- Makes the remaining proven WhatsApp behaviours configurable through the
-- EXISTING automation engine (event -> condition -> safe action -> run
-- ledger). No hardcoded business branches, no new engine.
--
--   * new events:  conversation.idle_timeout, conversation.priority_changed
--   * new actions: set_conversation_priority, set_conversation_handoff,
--                  send_whatsapp_template, request_document, add_tag
--   * every WhatsApp send action routes through inbox-actions (the same
--     window / suspension / credential / template-approval / provider /
--     ledger / cross-tenant path staff use)
--   * conversation idle is one bounded, indexed, set-based sweep inside the
--     EXISTING automations-tick worker (no new cron)
--   * automation-driven outbound is deduped on (automation_run_id,
--     automation_action_index) so a retried run never sends twice

-- 1. Automation taxonomy: two new conversation events ------------------
-- Additive: the list mirrors the Phase-7 re-add plus the two new values.

alter table public.domain_events drop constraint if exists domain_events_event_type_check;
alter table public.domain_events
  add constraint domain_events_event_type_check check (event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'conversation.intake_completed', 'conversation.handoff_sla_overdue',
    'conversation.document_received', 'conversation.ai_limit_reached',
    'conversation.idle_timeout', 'conversation.priority_changed',
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  ));

alter table public.automations drop constraint if exists automations_trigger_event_type_check;
alter table public.automations
  add constraint automations_trigger_event_type_check check (trigger_event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'conversation.intake_completed', 'conversation.handoff_sla_overdue',
    'conversation.document_received', 'conversation.ai_limit_reached',
    'conversation.idle_timeout', 'conversation.priority_changed',
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  ));

comment on column public.automations.idle_timeout_minutes is
  'How long the subject may sit quiet before automations-tick synthesizes the idle event. Used by BOTH lead.idle_timeout (leads.updated_at) and conversation.idle_timeout (inbox_conversations.last_inbound_at). Null for every other (purely event-driven) trigger. Different automations may use different thresholds.';

-- 2. Five new automation action types --------------------------------
-- Every one routes through an EXISTING dispatcher (inbox-actions) under the
-- automation creator's own impersonated permissions - no new capability.

alter table public.automation_actions drop constraint if exists automation_actions_action_type_check;
alter table public.automation_actions
  add constraint automation_actions_action_type_check check (action_type in (
    'create_lead', 'assign_lead', 'update_lead_stage',
    'create_opportunity', 'assign_opportunity',
    'create_internal_note', 'create_notification', 'request_flow_ai_analysis',
    'set_conversation_priority', 'set_conversation_handoff',
    'send_whatsapp_template', 'request_document', 'add_tag'
  ));

-- 3. Conversation tags - the smallest reusable model (none existed) ---
-- workspace-scoped, one row per (conversation, normalized tag). Read =
-- inbox.view; writes go through inbox-actions' add_tag (service role after
-- an inbox.manage check), same posture as inbox_alerts / inbox_messages.

create table if not exists public.inbox_conversation_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  tag text not null check (length(trim(tag)) between 1 and 60),
  source text not null default 'staff' check (source in ('staff', 'automation')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists inbox_conversation_tags_unique_idx
  on public.inbox_conversation_tags (workspace_id, conversation_id, lower(tag));
create index if not exists inbox_conversation_tags_conversation_idx
  on public.inbox_conversation_tags (conversation_id, created_at desc);

alter table public.inbox_conversation_tags enable row level security;

drop policy if exists "inbox_conversation_tags_select" on public.inbox_conversation_tags;
create policy "inbox_conversation_tags_select"
on public.inbox_conversation_tags for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'inbox.view'));
-- No client insert/update/delete policy - inbox-actions (service role,
-- after an inbox.manage check) is the only writer.

-- 4. Automation send idempotency on inbox_messages ------------------
-- A retried automation run re-executes its actions from the top; without
-- this a follow-up template could be sent twice. inbox-actions stamps the
-- outbound row with (automation_run_id, automation_action_index) and
-- refuses to send again if a row with that identity already exists.

-- automation_run_id is an opaque idempotency/audit key (the tick worker's
-- run id), not a relational entity we ever join through - a plain uuid,
-- like workspace_activity_log.target_id, so a later run cleanup never
-- cascades into message history.
alter table public.inbox_messages
  add column if not exists automation_run_id uuid,
  add column if not exists automation_action_index integer;

create unique index if not exists inbox_messages_automation_action_idx
  on public.inbox_messages (automation_run_id, automation_action_index)
  where automation_run_id is not null;

-- 5. Conversation idle sweep index -------------------------------------
-- scanIdleTimeouts filters: workspace_id = $1, still open (status<>'closed'
-- and inbox_status<>'resolved'), last_inbound_at < cutoff. Bounded + indexed
-- so event detection stays cheap (Phase-8 scale rule).

create index if not exists inbox_conversations_idle_idx
  on public.inbox_conversations (workspace_id, last_inbound_at)
  where status <> 'closed' and inbox_status <> 'resolved' and last_inbound_at is not null;
