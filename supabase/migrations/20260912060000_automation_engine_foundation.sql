-- Phase J (Automation Engine) foundation - V1 scope: event-triggered and
-- one time-based (idle-timeout) automations, deterministic actions only,
-- calling the SAME server-side dispatchers the UI already uses. No
-- Automation action can send WhatsApp messages, mutate a Meta campaign,
-- or execute AI-generated output directly - see docs/architecture/
-- automation-architecture.md.
--
-- event_type/action_type/operators are text + check (not enum) - like
-- leads.source/leads.status/opportunities.status, not like
-- ad_campaign_objective - because this taxonomy is expected to grow every
-- future phase, and enums require a non-transactional ALTER TYPE ADD
-- VALUE. A CHECK constraint is a normal migration to extend.

-- 1. has_workspace_permission_for() - the ACT authorization primitive ------
-- Identical logic to has_workspace_permission(), parameterized on an
-- explicit user id instead of auth.uid() - this is NOT a new bypass, it's
-- the same predicate evaluated for a specific, already-known person. Used
-- ONLY by the automation execution worker (service-role, itself gated by
-- a Vault-stored secret - see automations-tick) to check whether an
-- automation's recorded creator CURRENTLY holds the permission a given
-- action requires - never cached from creation time, so a creator later
-- demoted or removed from the workspace correctly blocks that automation's
-- next run.
create or replace function public.has_workspace_permission_for(p_workspace_id uuid, p_permission text, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.workspace_role_permissions wrp on wrp.role = wm.role
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and wrp.permission = p_permission
  );
$$;

comment on function public.has_workspace_permission_for(uuid, text, uuid) is
  'Same predicate as has_workspace_permission(), for an explicit user id instead of auth.uid(). Only ever called from the service-role automation worker to re-check an automation creator''s CURRENT permission at run time - never a bypass, and never callable usefully by a client (EXECUTE is fine to leave granted since it still requires real membership+permission, but the automation worker is the only realistic caller).';

-- 2. domain_events - the automation engine's own event log ------------------
-- Deliberately separate from workspace_activity_log (a human audit trail,
-- not designed for dedupe/processing bookkeeping). Populated by the SAME
-- existing dispatchers that already call logActivity() - one additional,
-- best-effort call alongside each, never a new business-logic path.

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null check (event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  )),
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  -- Deterministic per (event_type, entity_id, a caller-supplied version/
  -- timestamp token) - the SAME underlying lifecycle transition emitted
  -- twice (e.g. a retried edge function call) collapses to one row.
  dedupe_key text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Set once automations-tick has matched this event against every
  -- enabled automation for its trigger_event_type and created whatever
  -- automation_runs follow - never re-scanned after that, even if new
  -- automations are enabled later (matches "trigger fires going forward,
  -- not retroactively" - the same posture every other trigger-based system
  -- in this codebase takes).
  processed_at timestamptz
);

create unique index if not exists domain_events_dedupe_key_key on public.domain_events (dedupe_key);
create index if not exists domain_events_workspace_type_idx on public.domain_events (workspace_id, event_type, created_at desc);
create index if not exists domain_events_unprocessed_idx on public.domain_events (created_at) where processed_at is null;

alter table public.domain_events enable row level security;

drop policy if exists "domain_events_select_member" on public.domain_events;
create policy "domain_events_select_member"
on public.domain_events for select
to authenticated
using (public.is_workspace_member(workspace_id));

-- No client insert/update/delete policy - only existing server-side
-- dispatchers (service role) ever write a domain event, mirroring
-- workspace_activity_log's own posture exactly.

-- 3. automations --------------------------------------------------------------

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'enabled', 'disabled')),
  trigger_event_type text not null check (trigger_event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  )),
  -- Only meaningful when trigger_event_type = 'lead.idle_timeout' - how
  -- long a lead may sit untouched before automations-tick synthesizes the
  -- event. Null for every other (purely event-driven) trigger.
  idle_timeout_minutes integer check (idle_timeout_minutes is null or idle_timeout_minutes > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automations_workspace_idx on public.automations (workspace_id, status);
create index if not exists automations_trigger_idx on public.automations (workspace_id, trigger_event_type) where status = 'enabled';

drop trigger if exists set_automations_updated_at on public.automations;
create trigger set_automations_updated_at before update on public.automations
  for each row execute function public.set_updated_at();

alter table public.automations enable row level security;

drop policy if exists "automations_select_member" on public.automations;
create policy "automations_select_member"
on public.automations for select
to authenticated
using (public.is_workspace_member(workspace_id) and public.has_workspace_permission(workspace_id, 'automation.view'));

drop policy if exists "automations_insert_creator" on public.automations;
create policy "automations_insert_creator"
on public.automations for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'automation.create') and created_by = auth.uid());

drop policy if exists "automations_update_editor" on public.automations;
create policy "automations_update_editor"
on public.automations for update
to authenticated
using (public.has_workspace_permission(workspace_id, 'automation.edit') or public.has_workspace_permission(workspace_id, 'automation.enable'))
with check (public.has_workspace_permission(workspace_id, 'automation.edit') or public.has_workspace_permission(workspace_id, 'automation.enable'));

drop policy if exists "automations_delete_manager" on public.automations;
create policy "automations_delete_manager"
on public.automations for delete
to authenticated
using (public.has_workspace_permission(workspace_id, 'automation.delete'));

-- 4. automation_conditions (ANDed) ---------------------------------------------

create table if not exists public.automation_conditions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  field text not null check (length(field) <= 100),
  operator text not null check (operator in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'contains', 'is_null', 'is_not_null')),
  value jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists automation_conditions_automation_idx on public.automation_conditions (automation_id, sort_order);

alter table public.automation_conditions enable row level security;

drop policy if exists "automation_conditions_select_member" on public.automation_conditions;
create policy "automation_conditions_select_member"
on public.automation_conditions for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'automation.view'));

drop policy if exists "automation_conditions_write_editor" on public.automation_conditions;
create policy "automation_conditions_write_editor"
on public.automation_conditions for all
to authenticated
using (public.has_workspace_permission(workspace_id, 'automation.edit'))
with check (public.has_workspace_permission(workspace_id, 'automation.edit'));

-- 5. automation_actions (ordered) -----------------------------------------------

create table if not exists public.automation_actions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sort_order integer not null default 0,
  action_type text not null check (action_type in (
    'create_lead', 'assign_lead', 'update_lead_stage',
    'create_opportunity', 'assign_opportunity',
    'create_internal_note', 'create_notification', 'request_flow_ai_analysis'
  )),
  action_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists automation_actions_automation_idx on public.automation_actions (automation_id, sort_order);

alter table public.automation_actions enable row level security;

drop policy if exists "automation_actions_select_member" on public.automation_actions;
create policy "automation_actions_select_member"
on public.automation_actions for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'automation.view'));

drop policy if exists "automation_actions_write_editor" on public.automation_actions;
create policy "automation_actions_write_editor"
on public.automation_actions for all
to authenticated
using (public.has_workspace_permission(workspace_id, 'automation.edit'))
with check (public.has_workspace_permission(workspace_id, 'automation.edit'));

-- 6. automation_runs -----------------------------------------------------------
-- UNIQUE (automation_id, domain_event_id) is the idempotency anchor - the
-- SAME event can never spawn a second run of the SAME automation, exactly
-- mirroring ad_publish_operations_idempotency_key_key /
-- customers_one_per_opportunity_idx's discipline.

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  domain_event_id uuid not null references public.domain_events(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'succeeded', 'partial', 'failed', 'skipped_conditions_not_met', 'blocked_permission')),
  conditions_result jsonb not null default '[]'::jsonb,
  claimed_at timestamptz,
  claimed_by text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error jsonb,
  -- Loop prevention (durable rule - see automation-architecture.md and the
  -- Phase J investigation report): a run caused by an event that this
  -- run's own automation previously produced is rejected before it's ever
  -- created - see the emit-then-match worker logic, not enforced by SQL
  -- alone. depth guards the case where automation A's action triggers
  -- automation B whose action triggers automation A again.
  causation_domain_event_id uuid references public.domain_events(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  originating_automation_id uuid references public.automations(id) on delete set null,
  depth integer not null default 0 check (depth >= 0),
  created_at timestamptz not null default now()
);

create unique index if not exists automation_runs_automation_event_key on public.automation_runs (automation_id, domain_event_id);
create index if not exists automation_runs_workspace_idx on public.automation_runs (workspace_id, created_at desc);
create index if not exists automation_runs_claim_idx on public.automation_runs (status, next_retry_at);

alter table public.automation_runs enable row level security;

drop policy if exists "automation_runs_select_member" on public.automation_runs;
create policy "automation_runs_select_member"
on public.automation_runs for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'automation.view_runs'));

-- No client insert/update/delete policy - only the service-role
-- automations-tick worker ever writes a run.

-- 7. automation_run_steps -------------------------------------------------------

create table if not exists public.automation_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.automation_runs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sort_order integer not null default 0,
  action_type text not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'skipped')),
  result jsonb,
  error jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists automation_run_steps_run_idx on public.automation_run_steps (run_id, sort_order);

alter table public.automation_run_steps enable row level security;

drop policy if exists "automation_run_steps_select_member" on public.automation_run_steps;
create policy "automation_run_steps_select_member"
on public.automation_run_steps for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'automation.view_runs'));

-- No client write policy - service role only.

-- 8. notifications --------------------------------------------------------------
-- Not automation-specific plumbing - a genuinely new, general capability
-- (the header bell was already a disabled placeholder with nothing behind
-- it). Automation's create_notification action is simply its first real
-- producer.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'automation',
  title text not null check (length(title) <= 200),
  body text,
  related_entity_type text,
  related_entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (workspace_id, user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
on public.notifications for select
to authenticated
using (public.is_workspace_member(workspace_id) and user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
on public.notifications for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- No client insert/delete policy - only server-side actions (the
-- automation worker today) create notifications; a user may only mark
-- their own as read (the sole allowed update), never delete or create one.

-- 9. Permissions ----------------------------------------------------------------
-- automation.view/view_runs mirror content.view/campaign.metrics.view's
-- broad grant (every role, including viewer - configuration visibility,
-- not sensitive data). automation.create/edit/enable/delete are
-- manager-and-up, the same cutoff as pipeline.manage - reconfiguring a
-- workspace's automated behavior is a comparable responsibility to
-- reconfiguring its sales process.

insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'automation.view'), ('owner', 'automation.view_runs'), ('owner', 'automation.create'), ('owner', 'automation.edit'), ('owner', 'automation.enable'), ('owner', 'automation.delete'),
  ('admin', 'automation.view'), ('admin', 'automation.view_runs'), ('admin', 'automation.create'), ('admin', 'automation.edit'), ('admin', 'automation.enable'), ('admin', 'automation.delete'),
  ('manager', 'automation.view'), ('manager', 'automation.view_runs'), ('manager', 'automation.create'), ('manager', 'automation.edit'), ('manager', 'automation.enable'), ('manager', 'automation.delete'),
  ('marketing', 'automation.view'), ('marketing', 'automation.view_runs'),
  ('sales', 'automation.view'), ('sales', 'automation.view_runs'),
  ('support', 'automation.view'), ('support', 'automation.view_runs'),
  ('viewer', 'automation.view'), ('viewer', 'automation.view_runs')
on conflict (role, permission) do nothing;
