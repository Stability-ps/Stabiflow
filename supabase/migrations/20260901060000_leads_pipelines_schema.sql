-- Phase E (Leads, Pipelines & Opportunities).
--
-- Generic conversion-management layer: Conversation -> Lead -> Qualification
-- -> Pipeline -> Opportunity -> Customer. Reference: Acapolite's WhatsApp
-- "Open Request" workflow (structured-record-from-conversation, staff
-- ownership/assignment, internal notes, status changes, audit logging,
-- resolved/open lifecycle) - read-only reference, patterns generalized, not
-- its tax-specific request model. Nothing here is named/shaped around any
-- one industry: pipelines/stages are entirely workspace-configurable, the
-- opportunity table is generic (not "requests"), and lead sources are a
-- fixed enum of channels, never fabricated campaign attribution.
--
-- No campaign/ad attribution, no AI qualification/scoring, no revenue
-- analytics are built here - attribution_events (Phase 2) already has the
-- subject_type 'lead'/'opportunity'/'customer' hook a later phase will use;
-- estimated_value/actual_value are stored but never aggregated into a
-- dashboard in this phase.

-- 1. Fine-grained permissions ----------------------------------------------------
-- Mirrors content.*/campaign.*/inbox.* (Phase 5/6/D). Sales owns leads day
-- to day; support can see them (a conversation they're handling may already
-- have one) but not create/edit/assign - matches its inbox.view-only-esque
-- role in Content. Pipeline configuration is manager-and-up (a workspace's
-- sales process is a structural decision, not a day-to-day action).

insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'lead.view'), ('owner', 'lead.create'), ('owner', 'lead.edit'), ('owner', 'lead.assign'), ('owner', 'lead.delete'),
  ('owner', 'pipeline.view'), ('owner', 'pipeline.manage'),
  ('owner', 'opportunity.view'), ('owner', 'opportunity.create'), ('owner', 'opportunity.edit'), ('owner', 'opportunity.close'),

  ('admin', 'lead.view'), ('admin', 'lead.create'), ('admin', 'lead.edit'), ('admin', 'lead.assign'), ('admin', 'lead.delete'),
  ('admin', 'pipeline.view'), ('admin', 'pipeline.manage'),
  ('admin', 'opportunity.view'), ('admin', 'opportunity.create'), ('admin', 'opportunity.edit'), ('admin', 'opportunity.close'),

  ('manager', 'lead.view'), ('manager', 'lead.create'), ('manager', 'lead.edit'), ('manager', 'lead.assign'), ('manager', 'lead.delete'),
  ('manager', 'pipeline.view'), ('manager', 'pipeline.manage'),
  ('manager', 'opportunity.view'), ('manager', 'opportunity.create'), ('manager', 'opportunity.edit'), ('manager', 'opportunity.close'),

  ('sales', 'lead.view'), ('sales', 'lead.create'), ('sales', 'lead.edit'), ('sales', 'lead.assign'),
  ('sales', 'pipeline.view'),
  ('sales', 'opportunity.view'), ('sales', 'opportunity.create'), ('sales', 'opportunity.edit'), ('sales', 'opportunity.close'),

  -- Support sees leads (a conversation they're handling may already have
  -- one linked) and can create one from that conversation, but doesn't
  -- own the pipeline or close deals.
  ('support', 'lead.view'), ('support', 'lead.create'),
  ('support', 'pipeline.view'),
  ('support', 'opportunity.view'),

  ('marketing', 'lead.view'), ('marketing', 'pipeline.view'), ('marketing', 'opportunity.view'),
  ('viewer', 'lead.view'), ('viewer', 'pipeline.view'), ('viewer', 'opportunity.view')
on conflict (role, permission) do nothing;

-- 2. pipelines / pipeline_stages ---------------------------------------------------

create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one default pipeline per workspace - enforced here rather than
-- trusted to application code, so set_default_pipeline's "unset the old
-- one, set the new one" two-step can never race into two defaults.
create unique index if not exists pipelines_one_default_idx
  on public.pipelines (workspace_id) where is_default;
create index if not exists pipelines_workspace_idx on public.pipelines (workspace_id, created_at);

drop trigger if exists set_pipelines_updated_at on public.pipelines;
create trigger set_pipelines_updated_at before update on public.pipelines
  for each row execute function public.set_updated_at();

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  -- Descriptive only (see completion report): does not itself flip an
  -- opportunity's status. A pipeline may mark at most one stage as "the"
  -- won/lost stage for UI purposes (e.g. suggesting mark_opportunity_won
  -- when a card lands here); the actual won/lost outcome is always
  -- recorded via an explicit action on the opportunity itself.
  is_won_stage boolean not null default false,
  is_lost_stage boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pipeline_stages_pipeline_idx
  on public.pipeline_stages (pipeline_id, sort_order);
create index if not exists pipeline_stages_workspace_idx
  on public.pipeline_stages (workspace_id);
create unique index if not exists pipeline_stages_one_won_idx
  on public.pipeline_stages (pipeline_id) where is_won_stage;
create unique index if not exists pipeline_stages_one_lost_idx
  on public.pipeline_stages (pipeline_id) where is_lost_stage;

drop trigger if exists set_pipeline_stages_updated_at on public.pipeline_stages;
create trigger set_pipeline_stages_updated_at before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

-- Defense-in-depth (durable rule #24): a stage's workspace_id must match
-- its OWN pipeline's workspace_id - an ordinary FK on pipeline_id alone
-- would happily accept a pipeline belonging to a different workspace as
-- long as the stage row claimed workspace_id A itself.
create or replace function public.pipeline_stages_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.pipelines where id = new.pipeline_id and workspace_id = new.workspace_id
  ) then
    raise exception 'pipeline_stages.workspace_id must match its pipeline_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists pipeline_stages_validate_workspace_trg on public.pipeline_stages;
create trigger pipeline_stages_validate_workspace_trg
  before insert or update on public.pipeline_stages
  for each row execute function public.pipeline_stages_validate_workspace();

-- 3. workspace_lead_counters / human-readable lead reference -----------------------
-- Collision-safe, race-free per-workspace sequence: an UPDATE ... RETURNING
-- on a single locked row is atomic under Postgres's row-level locking (a
-- concurrent UPDATE on the same workspace_id blocks until the first
-- transaction commits), unlike "SELECT max(...) + 1" which is a classic
-- TOCTOU race under real concurrency. Never used as a primary key - leads.id
-- stays a uuid; human_reference is a separate, human-facing column.

create table if not exists public.workspace_lead_counters (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  last_value bigint not null default 0
);

create or replace function public.next_lead_reference(p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  insert into public.workspace_lead_counters (workspace_id, last_value)
  values (p_workspace_id, 0)
  on conflict (workspace_id) do nothing;

  update public.workspace_lead_counters
  set last_value = last_value + 1
  where workspace_id = p_workspace_id
  returning last_value into v_next;

  return 'LEAD-' || lpad(v_next::text, 6, '0');
end;
$$;

-- 4. leads --------------------------------------------------------------------------

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  human_reference text not null,

  contact_name text check (contact_name is null or length(contact_name) <= 200),
  phone text check (phone is null or length(phone) <= 50),
  phone_normalized text check (phone_normalized is null or length(phone_normalized) <= 50),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company_name text check (company_name is null or length(company_name) <= 200),

  -- Fixed, generic channel enum - never fabricated. A WhatsApp-origin lead
  -- with no campaign behind it simply has source = 'whatsapp' and nothing
  -- else; attribution is a later phase's job, not this one's.
  source text not null check (source in ('whatsapp', 'meta', 'website', 'manual', 'referral', 'organic', 'google_later', 'other')),
  source_detail text check (source_detail is null or length(source_detail) <= 500),

  status text not null default 'active' check (status in ('active', 'converted', 'lost')),

  assigned_to uuid references public.profiles(id) on delete set null,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  pipeline_stage_id uuid references public.pipeline_stages(id) on delete set null,

  qualification_status text not null default 'unqualified' check (qualification_status in ('unqualified', 'qualifying', 'qualified', 'not_qualified')),
  qualification_notes text check (qualification_notes is null or length(qualification_notes) <= 2000),
  qualification_reason text check (qualification_reason is null or length(qualification_reason) <= 500),

  estimated_value numeric(14, 2) check (estimated_value is null or estimated_value >= 0),
  summary text check (summary is null or length(summary) <= 2000),

  created_from_conversation_id uuid references public.inbox_conversations(id) on delete set null,
  lost_reason text check (lost_reason is null or length(lost_reason) <= 500),

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  converted_at timestamptz,
  lost_at timestamptz
);

create unique index if not exists leads_workspace_reference_key
  on public.leads (workspace_id, human_reference);
create index if not exists leads_workspace_status_idx
  on public.leads (workspace_id, status, updated_at desc);
create index if not exists leads_workspace_stage_idx
  on public.leads (workspace_id, pipeline_id, pipeline_stage_id);
create index if not exists leads_assigned_idx
  on public.leads (assigned_to, updated_at desc) where assigned_to is not null;
create index if not exists leads_workspace_phone_idx
  on public.leads (workspace_id, phone_normalized) where phone_normalized is not null;
create index if not exists leads_conversation_idx
  on public.leads (created_from_conversation_id) where created_from_conversation_id is not null;

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

create or replace function public.leads_assign_human_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.human_reference is null or length(trim(new.human_reference)) = 0 then
    new.human_reference := public.next_lead_reference(new.workspace_id);
  end if;
  return new;
end;
$$;

drop trigger if exists leads_assign_human_reference_trg on public.leads;
create trigger leads_assign_human_reference_trg
  before insert on public.leads
  for each row execute function public.leads_assign_human_reference();

-- Defense-in-depth (durable rule #24): a lead's pipeline/stage/assignee/
-- source-conversation must all belong to the SAME workspace as the lead
-- itself - each is an independent FK that, alone, would happily accept a
-- valid id from a different workspace.
create or replace function public.leads_validate_workspace_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pipeline_id is not null and not exists (
    select 1 from public.pipelines where id = new.pipeline_id and workspace_id = new.workspace_id
  ) then
    raise exception 'leads.pipeline_id must belong to the same workspace as the lead' using errcode = '23514';
  end if;

  if new.pipeline_stage_id is not null and not exists (
    select 1 from public.pipeline_stages
    where id = new.pipeline_stage_id
      and workspace_id = new.workspace_id
      and (new.pipeline_id is null or pipeline_id = new.pipeline_id)
  ) then
    raise exception 'leads.pipeline_stage_id must belong to the same workspace/pipeline as the lead' using errcode = '23514';
  end if;

  if new.assigned_to is not null and not exists (
    select 1 from public.workspace_members where workspace_id = new.workspace_id and user_id = new.assigned_to
  ) then
    raise exception 'leads.assigned_to must be a member of the lead''s workspace' using errcode = '23514';
  end if;

  if new.created_from_conversation_id is not null and not exists (
    select 1 from public.inbox_conversations where id = new.created_from_conversation_id and workspace_id = new.workspace_id
  ) then
    raise exception 'leads.created_from_conversation_id must belong to the same workspace as the lead' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists leads_validate_workspace_consistency_trg on public.leads;
create trigger leads_validate_workspace_consistency_trg
  before insert or update on public.leads
  for each row execute function public.leads_validate_workspace_consistency();

-- 5. inbox_conversations <-> leads linkage ------------------------------------------
-- Explicit FK, not phone-number re-matching after the fact (durable rule
-- #20): once linked, a conversation resolves its lead directly via this
-- column. Nullable/no uniqueness constraint - a workspace may (rarely)
-- want more than one conversation pointing at the same lead (e.g. the
-- customer messages from a second number later), but a given conversation
-- always has at most one lead.

alter table public.inbox_conversations
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

create index if not exists inbox_conversations_lead_idx
  on public.inbox_conversations (lead_id) where lead_id is not null;

create or replace function public.inbox_conversations_validate_lead_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is not null and not exists (
    select 1 from public.leads where id = new.lead_id and workspace_id = new.workspace_id
  ) then
    raise exception 'inbox_conversations.lead_id must belong to the same workspace as the conversation' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists inbox_conversations_validate_lead_workspace_trg on public.inbox_conversations;
create trigger inbox_conversations_validate_lead_workspace_trg
  before insert or update of lead_id on public.inbox_conversations
  for each row execute function public.inbox_conversations_validate_lead_workspace();

-- 6. opportunities --------------------------------------------------------------

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,

  pipeline_id uuid references public.pipelines(id) on delete set null,
  pipeline_stage_id uuid references public.pipeline_stages(id) on delete set null,

  title text not null check (length(trim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 2000),

  assigned_to uuid references public.profiles(id) on delete set null,
  estimated_value numeric(14, 2) check (estimated_value is null or estimated_value >= 0),
  actual_value numeric(14, 2) check (actual_value is null or actual_value >= 0),
  probability integer check (probability is null or (probability between 0 and 100)),

  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text check (lost_reason is null or length(lost_reason) <= 500),

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists opportunities_workspace_status_idx
  on public.opportunities (workspace_id, status, updated_at desc);
create index if not exists opportunities_lead_idx
  on public.opportunities (lead_id, created_at desc);
create index if not exists opportunities_stage_idx
  on public.opportunities (workspace_id, pipeline_id, pipeline_stage_id);
create index if not exists opportunities_assigned_idx
  on public.opportunities (assigned_to, updated_at desc) where assigned_to is not null;

drop trigger if exists set_opportunities_updated_at on public.opportunities;
create trigger set_opportunities_updated_at before update on public.opportunities
  for each row execute function public.set_updated_at();

create or replace function public.opportunities_validate_workspace_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.leads where id = new.lead_id and workspace_id = new.workspace_id) then
    raise exception 'opportunities.lead_id must belong to the same workspace as the opportunity' using errcode = '23514';
  end if;

  if new.pipeline_id is not null and not exists (
    select 1 from public.pipelines where id = new.pipeline_id and workspace_id = new.workspace_id
  ) then
    raise exception 'opportunities.pipeline_id must belong to the same workspace as the opportunity' using errcode = '23514';
  end if;

  if new.pipeline_stage_id is not null and not exists (
    select 1 from public.pipeline_stages
    where id = new.pipeline_stage_id
      and workspace_id = new.workspace_id
      and (new.pipeline_id is null or pipeline_id = new.pipeline_id)
  ) then
    raise exception 'opportunities.pipeline_stage_id must belong to the same workspace/pipeline as the opportunity' using errcode = '23514';
  end if;

  if new.assigned_to is not null and not exists (
    select 1 from public.workspace_members where workspace_id = new.workspace_id and user_id = new.assigned_to
  ) then
    raise exception 'opportunities.assigned_to must be a member of the opportunity''s workspace' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists opportunities_validate_workspace_consistency_trg on public.opportunities;
create trigger opportunities_validate_workspace_consistency_trg
  before insert or update on public.opportunities
  for each row execute function public.opportunities_validate_workspace_consistency();

-- 7. customers ------------------------------------------------------------------
-- Deliberately minimal (durable rule #31): no invoicing/billing/contracts/
-- support tickets. Just enough to record "this lead/opportunity became a
-- paying customer" - a later phase can build a real CRM on top without a
-- breaking schema change here.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,

  name text not null check (length(trim(name)) between 1 and 200),
  phone text check (phone is null or length(phone) <= 50),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company_name text check (company_name is null or length(company_name) <= 200),

  customer_since timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Idempotency: retrying mark_opportunity_won with create_customer=true must
-- never mint a second customer row for the same win.
create unique index if not exists customers_one_per_opportunity_idx
  on public.customers (opportunity_id) where opportunity_id is not null;
create index if not exists customers_workspace_idx
  on public.customers (workspace_id, created_at desc);
create index if not exists customers_lead_idx
  on public.customers (lead_id) where lead_id is not null;

create or replace function public.customers_validate_workspace_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is not null and not exists (
    select 1 from public.leads where id = new.lead_id and workspace_id = new.workspace_id
  ) then
    raise exception 'customers.lead_id must belong to the same workspace as the customer' using errcode = '23514';
  end if;

  if new.opportunity_id is not null and not exists (
    select 1 from public.opportunities where id = new.opportunity_id and workspace_id = new.workspace_id
  ) then
    raise exception 'customers.opportunity_id must belong to the same workspace as the customer' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists customers_validate_workspace_consistency_trg on public.customers;
create trigger customers_validate_workspace_consistency_trg
  before insert or update on public.customers
  for each row execute function public.customers_validate_workspace_consistency();

-- 8. crm_notes --------------------------------------------------------------------
-- One polymorphic table (target_type/target_id) rather than a forked
-- lead_notes/opportunity_notes pair - same convention attribution_events
-- already uses for subject_type/subject_id. Structured (actor, timestamp,
-- body, target), never a single overloaded free-text field.

create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  target_type text not null check (target_type in ('lead', 'opportunity')),
  target_id uuid not null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists crm_notes_target_idx
  on public.crm_notes (target_type, target_id, created_at desc);
create index if not exists crm_notes_workspace_idx
  on public.crm_notes (workspace_id, created_at desc);

create or replace function public.crm_notes_validate_target()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.target_type = 'lead' and not exists (
    select 1 from public.leads where id = new.target_id and workspace_id = new.workspace_id
  ) then
    raise exception 'crm_notes.target_id must be a lead in the same workspace' using errcode = '23514';
  end if;

  if new.target_type = 'opportunity' and not exists (
    select 1 from public.opportunities where id = new.target_id and workspace_id = new.workspace_id
  ) then
    raise exception 'crm_notes.target_id must be an opportunity in the same workspace' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists crm_notes_validate_target_trg on public.crm_notes;
create trigger crm_notes_validate_target_trg
  before insert or update on public.crm_notes
  for each row execute function public.crm_notes_validate_target();

-- 9. RLS --------------------------------------------------------------------------

alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.leads enable row level security;
alter table public.opportunities enable row level security;
alter table public.customers enable row level security;
alter table public.crm_notes enable row level security;

drop policy if exists "pipelines_select" on public.pipelines;
create policy "pipelines_select"
on public.pipelines for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'pipeline.view'));

drop policy if exists "pipelines_write" on public.pipelines;
create policy "pipelines_write"
on public.pipelines for all
to authenticated
using (public.has_workspace_permission(workspace_id, 'pipeline.manage'))
with check (public.has_workspace_permission(workspace_id, 'pipeline.manage'));

drop policy if exists "pipeline_stages_select" on public.pipeline_stages;
create policy "pipeline_stages_select"
on public.pipeline_stages for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'pipeline.view'));

drop policy if exists "pipeline_stages_write" on public.pipeline_stages;
create policy "pipeline_stages_write"
on public.pipeline_stages for all
to authenticated
using (public.has_workspace_permission(workspace_id, 'pipeline.manage'))
with check (public.has_workspace_permission(workspace_id, 'pipeline.manage'));

drop policy if exists "leads_select" on public.leads;
create policy "leads_select"
on public.leads for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'lead.view'));

drop policy if exists "leads_insert" on public.leads;
create policy "leads_insert"
on public.leads for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'lead.create'));

drop policy if exists "leads_update" on public.leads;
create policy "leads_update"
on public.leads for update
to authenticated
using (public.has_workspace_permission(workspace_id, 'lead.edit'))
with check (public.has_workspace_permission(workspace_id, 'lead.edit'));
-- No client DELETE policy: leads are never hard-deleted (status flips to
-- 'lost' instead) - matches "do not hard-delete" for pipeline stages and
-- the general product convention (Content/Campaigns never hard-delete
-- published history either).

drop policy if exists "opportunities_select" on public.opportunities;
create policy "opportunities_select"
on public.opportunities for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'opportunity.view'));

drop policy if exists "opportunities_insert" on public.opportunities;
create policy "opportunities_insert"
on public.opportunities for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'opportunity.create'));

drop policy if exists "opportunities_update" on public.opportunities;
create policy "opportunities_update"
on public.opportunities for update
to authenticated
using (public.has_workspace_permission(workspace_id, 'opportunity.edit') or public.has_workspace_permission(workspace_id, 'opportunity.close'))
with check (public.has_workspace_permission(workspace_id, 'opportunity.edit') or public.has_workspace_permission(workspace_id, 'opportunity.close'));

drop policy if exists "customers_select" on public.customers;
create policy "customers_select"
on public.customers for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'opportunity.view'));
-- No authenticated write policy: customers are only ever created as a
-- side effect of mark_opportunity_won (service role, after the caller's
-- own opportunity.close permission was already verified) - same
-- "server creates, staff reads" shape as inbox_messages.

drop policy if exists "crm_notes_select" on public.crm_notes;
create policy "crm_notes_select"
on public.crm_notes for select
to authenticated
using (
  (target_type = 'lead' and public.has_workspace_permission(workspace_id, 'lead.view'))
  or (target_type = 'opportunity' and public.has_workspace_permission(workspace_id, 'opportunity.view'))
);

drop policy if exists "crm_notes_insert" on public.crm_notes;
create policy "crm_notes_insert"
on public.crm_notes for insert
to authenticated
with check (
  author_id = auth.uid()
  and (
    (target_type = 'lead' and public.has_workspace_permission(workspace_id, 'lead.edit'))
    or (target_type = 'opportunity' and public.has_workspace_permission(workspace_id, 'opportunity.edit'))
  )
);
