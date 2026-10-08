-- Phase 3 - Structured Intake + Real Ask Info.
--
-- A workspace can now DEFINE "what must I collect before an enquiry is
-- qualified?" as a reusable schema of ordered fields. StabiFlow uses that
-- definition to extract known answers from a WhatsApp conversation,
-- identify what is still missing, ask the next useful question, and - when
-- every required field is answered - emit conversation.intake_completed so
-- the EXISTING automation engine can act.
--
-- Design constraints honoured here:
--   * NOT a parallel intake store. inbox_conversations.intake_payload and
--     leads.intake (Phase 2) remain the only places a conversation's/lead's
--     collected answers live. This migration adds the *definition* tables
--     plus two bookkeeping columns on inbox_conversations; the payload
--     shape generalises to { schema_id, fields: {...} } with a
--     compatibility reader for every historical flat payload.
--   * No giant form-builder. A small fixed set of useful field types, an
--     optional per-field config jsonb for select options / numeric bounds,
--     and nothing else.
--   * Reuses the has_workspace_permission() model. Two new permissions,
--     mirroring automation.view / automation.create exactly: intake.view
--     (broad - configuration visibility, no customer data) and
--     intake.manage (manager-and-up, same cutoff as pipeline.manage).
--   * A workspace with NO schema keeps working unchanged - every code path
--     added in Phase 3 is a no-op when resolveActiveIntakeSchema() finds
--     nothing.

-- 1. Permissions -------------------------------------------------------------

insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'intake.view'), ('owner', 'intake.manage'),
  ('admin', 'intake.view'), ('admin', 'intake.manage'),
  ('manager', 'intake.view'), ('manager', 'intake.manage'),
  ('marketing', 'intake.view'),
  ('sales', 'intake.view'),
  ('support', 'intake.view'),
  ('viewer', 'intake.view')
on conflict (role, permission) do nothing;

-- 2. workspace_intake_schemas ---------------------------------------------------

create table if not exists public.workspace_intake_schemas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  -- Exactly one default per workspace (partial unique index below). The
  -- default is what resolveActiveIntakeSchema() falls back to when a
  -- conversation's WhatsApp number has no explicit selection.
  is_default boolean not null default false,
  -- Deactivation, never destructive deletion, is the safe way to retire a
  -- schema whose historical conversations still reference it.
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_intake_schemas_workspace_idx
  on public.workspace_intake_schemas (workspace_id, is_active);
create unique index if not exists workspace_intake_schemas_one_default_idx
  on public.workspace_intake_schemas (workspace_id)
  where is_default;

drop trigger if exists set_workspace_intake_schemas_updated_at on public.workspace_intake_schemas;
create trigger set_workspace_intake_schemas_updated_at before update on public.workspace_intake_schemas
  for each row execute function public.set_updated_at();

comment on table public.workspace_intake_schemas is
  'Phase 3: a reusable, workspace-owned definition of the information a workspace wants collected before an enquiry is qualified. Referenced by inbox_conversations.intake_schema_id and workspace_whatsapp_numbers.intake_schema_id; never itself stores a conversation''s answers.';

-- 3. workspace_intake_fields --------------------------------------------------

create table if not exists public.workspace_intake_fields (
  id uuid primary key default gen_random_uuid(),
  schema_id uuid not null references public.workspace_intake_schemas(id) on delete cascade,
  -- Denormalised for RLS + a cheap workspace-consistency guard (same shape
  -- as automation_conditions.workspace_id / lead_attachments).
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Stable identifier used as the key inside intake_payload.fields and
  -- leads.intake.fields. Immutable after creation (see intake-actions) so
  -- historical answers are never silently orphaned.
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  label text not null check (length(trim(label)) between 1 and 200),
  question_text text not null check (length(trim(question_text)) between 1 and 500),
  field_type text not null check (field_type in (
    'text', 'textarea', 'email', 'phone', 'number', 'currency',
    'date', 'boolean', 'single_select', 'multi_select'
  )),
  required boolean not null default false,
  sort_order integer not null default 0,
  help_text text check (help_text is null or length(help_text) <= 1000),
  is_active boolean not null default true,
  -- Only for select types (an "options" string array) and numeric types
  -- (optional "min"/"max"). Never a free-form rules engine.
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_intake_fields_schema_key_idx
  on public.workspace_intake_fields (schema_id, key);
create index if not exists workspace_intake_fields_schema_order_idx
  on public.workspace_intake_fields (schema_id, sort_order, key);

drop trigger if exists set_workspace_intake_fields_updated_at on public.workspace_intake_fields;
create trigger set_workspace_intake_fields_updated_at before update on public.workspace_intake_fields
  for each row execute function public.set_updated_at();

create or replace function public.workspace_intake_fields_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_intake_schemas
    where id = new.schema_id and workspace_id = new.workspace_id
  ) then
    raise exception 'workspace_intake_fields.workspace_id must match its schema''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_intake_fields_validate_workspace_trg on public.workspace_intake_fields;
create trigger workspace_intake_fields_validate_workspace_trg
  before insert or update on public.workspace_intake_fields
  for each row execute function public.workspace_intake_fields_validate_workspace();

comment on table public.workspace_intake_fields is
  'Phase 3: one ordered field in a workspace_intake_schemas definition. `key` is stable and immutable; deleting/deactivating a field never touches the historical answer stored under that key in any intake_payload.';

-- 4. inbox_conversations bookkeeping ----------------------------------------
-- intake_schema_id: which schema drove THIS conversation's intake, pinned
--   the first time the AI processes a message under a resolved schema so a
--   later default change does not retroactively reinterpret an in-flight
--   conversation.
-- intake_completed_at: the one-shot "incomplete -> complete" transition
--   marker. Stamped exactly once (race-safe conditional UPDATE) and used as
--   the guard that conversation.intake_completed is emitted once per
--   conversation, retries/replays included.

alter table public.inbox_conversations
  add column if not exists intake_schema_id uuid references public.workspace_intake_schemas(id) on delete set null,
  add column if not exists intake_completed_at timestamptz;

-- 5. per-WhatsApp-number schema selection ----------------------------------
-- A number either points at a specific active schema or (null) inherits the
-- workspace default. One schema, many numbers - never a copy per number.

alter table public.workspace_whatsapp_numbers
  add column if not exists intake_schema_id uuid references public.workspace_intake_schemas(id) on delete set null;

-- 6. RLS ------------------------------------------------------------------------
-- Read: intake.view (broad). Write: none from the client - every mutation
-- goes through the intake-actions edge function with the service role after
-- an intake.manage check, the same backend-authoritative pattern as
-- pipelines-actions / leads-actions.

alter table public.workspace_intake_schemas enable row level security;
alter table public.workspace_intake_fields enable row level security;

drop policy if exists "workspace_intake_schemas_select" on public.workspace_intake_schemas;
create policy "workspace_intake_schemas_select"
on public.workspace_intake_schemas for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'intake.view'));

drop policy if exists "workspace_intake_fields_select" on public.workspace_intake_fields;
create policy "workspace_intake_fields_select"
on public.workspace_intake_fields for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'intake.view'));

-- 7. Realtime (settings UI live-refresh, same as pipelines/leads) -----------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_intake_schemas'
  ) then
    alter publication supabase_realtime add table public.workspace_intake_schemas;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_intake_fields'
  ) then
    alter publication supabase_realtime add table public.workspace_intake_fields;
  end if;
end $$;
