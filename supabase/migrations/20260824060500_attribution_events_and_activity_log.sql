-- attribution_events: the raw touchpoint stream. Every hop in
-- campaign -> ad set -> ad -> creative -> conversation -> lead ->
-- opportunity -> customer gets recorded here as it happens, so StabiFlow
-- is never limited to "one campaign id per lead" - a lead can accumulate
-- many events over its lifetime, and proper multi-touch attribution
-- modelling can be built later purely as a query over this table, with
-- zero data migration, because the raw events were preserved from day one.
--
-- event_type/platform/subject_type are TEXT, not enums, on purpose: this
-- table has to accept new event kinds and new ad platforms (Google, TikTok
-- - see the source-agnostic architecture note) without a schema migration
-- every time.

create table if not exists public.attribution_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  event_type text not null, -- e.g. ad_impression, ad_click, conversation_started, lead_created, stage_changed, opportunity_created, customer_won
  occurred_at timestamptz not null default now(),

  -- Where this touchpoint came from. All nullable: an organic WhatsApp
  -- message has no campaign behind it, and that's a normal case, not
  -- missing data.
  platform text, -- meta | google | tiktok | organic | direct | referral
  external_campaign_id text,
  external_adset_id text,
  external_ad_id text,
  external_creative_id text,

  -- What this event happened TO. Polymorphic by convention (subject_type
  -- names which downstream table subject_id points at) rather than a hard
  -- FK, because not every subject table exists yet in Phase 2/3 - leads/
  -- opportunities/customers land in Phase 8. Once they exist, application
  -- code and later a validating trigger can enforce subject_type's
  -- allowed values; kept open now so this migration doesn't have to
  -- anticipate the exact leads schema.
  subject_type text, -- conversation | lead | opportunity | customer
  subject_id uuid,

  attribution_source text, -- utm | click_id | manual | inferred
  attribution_confidence text, -- high | medium | low

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attribution_events_workspace_time_idx
  on public.attribution_events (workspace_id, occurred_at desc);
create index if not exists attribution_events_subject_idx
  on public.attribution_events (workspace_id, subject_type, subject_id);
create index if not exists attribution_events_campaign_idx
  on public.attribution_events (workspace_id, external_campaign_id)
  where external_campaign_id is not null;

alter table public.attribution_events enable row level security;

drop policy if exists "attribution_events_select_member" on public.attribution_events;
create policy "attribution_events_select_member"
on public.attribution_events for select
to authenticated
using (public.is_workspace_member(workspace_id));

-- Insert is intentionally available to any workspace member with
-- view_analytics-or-better (i.e. effectively any real member) rather than
-- admin-only: attribution events get written as a side effect of normal
-- product use (a message arrives, a stage changes), not as an admin
-- action. Edge functions writing on the system's behalf use the service
-- role key and bypass RLS entirely, same pattern as every other
-- system-authored table in this schema.
drop policy if exists "attribution_events_insert_member" on public.attribution_events;
create policy "attribution_events_insert_member"
on public.attribution_events for insert
to authenticated
with check (public.is_workspace_member(workspace_id));

-- Deliberately no update/delete policy for regular members: attribution
-- events are an append-only audit trail. Corrections happen by inserting
-- a new event, not editing history.

-- workspace_activity_log --------------------------------------------------------
-- Same (actor, action, target, metadata, timestamp) shape as Acapolite's
-- system_activity_log, with workspace_id added - the one piece of that
-- table worth copying verbatim per the audit.

create table if not exists public.workspace_activity_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_role public.workspace_role,
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workspace_activity_log_workspace_idx
  on public.workspace_activity_log (workspace_id, created_at desc);

alter table public.workspace_activity_log enable row level security;

drop policy if exists "workspace_activity_log_select_member" on public.workspace_activity_log;
create policy "workspace_activity_log_select_member"
on public.workspace_activity_log for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_activity_log_insert_member" on public.workspace_activity_log;
create policy "workspace_activity_log_insert_member"
on public.workspace_activity_log for insert
to authenticated
with check (public.is_workspace_member(workspace_id));
