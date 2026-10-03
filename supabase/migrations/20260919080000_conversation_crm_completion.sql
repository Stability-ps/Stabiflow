-- Phase 2 - Conversation -> CRM completion.
--
-- A WhatsApp conversation already converts into a lead
-- (leads-actions.create_from_conversation), but the useful context the AI
-- collected is left stranded on inbox_conversations / inbox_messages. This
-- migration adds the two additive structures the conversion path needs to
-- carry that context onto the lead:
--
--   1. leads.intake jsonb - the conversation's intake_payload, preserved
--      verbatim. NOT a new intake schema (that is Phase 3). Just storage
--      for whatever structured answers already exist so they are not lost.
--
--   2. lead_attachments - a RELATIONSHIP table that references the media
--      object a customer already sent on WhatsApp (inbox_messages.media_*
--      in the private 'inbox-media' bucket). NO bytes are copied and NO
--      re-upload happens; the row points at the existing object. Every row
--      is workspace-scoped and workspace-consistent with its lead, and
--      RLS is the same lead.view/lead.edit model every other CRM table
--      uses - no new permission.
--
-- Nothing here weakens multi-tenancy, RLS, the Vault credential model, the
-- attribution chain, or the automation engine. Writes to lead_attachments
-- go through leads-actions with the service role (backend authoritative),
-- exactly like crm_notes.

-- 1. leads.intake -------------------------------------------------------------

alter table public.leads
  add column if not exists intake jsonb not null default '{}'::jsonb;

comment on column public.leads.intake is
  'Phase 2: the originating conversation''s intake_payload, preserved verbatim at create/link time so AI-collected structured answers are not lost at conversion. Merged non-destructively when a conversation is linked to an existing lead (existing keys win). A workspace-configurable intake schema is Phase 3 - this column is just storage, never a schema.';

-- 2. lead_attachments -------------------------------------------------------------

create table if not exists public.lead_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,

  -- Provenance - where this file came from. Nullable because a message /
  -- conversation could later be deleted without orphaning the (still
  -- useful) attachment link.
  conversation_id uuid references public.inbox_conversations(id) on delete set null,
  message_id uuid references public.inbox_messages(id) on delete set null,

  -- Pointer at the EXISTING stored object - never a copy. Bucket is
  -- recorded explicitly so a future non-WhatsApp source can reuse this
  -- table without ambiguity.
  storage_bucket text not null default 'inbox-media' check (length(storage_bucket) <= 100),
  storage_path text not null check (length(storage_path) between 1 and 1024),

  media_mime_type text check (media_mime_type is null or length(media_mime_type) <= 255),
  media_filename text check (media_filename is null or length(media_filename) <= 500),
  media_size_bytes integer check (media_size_bytes is null or media_size_bytes >= 0),

  source text not null default 'whatsapp_conversation'
    check (source in ('whatsapp_conversation')),
  received_at timestamptz, -- when the customer originally sent it (message.created_at)

  linked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One link per (lead, object) - re-running the conversion / re-linking a
-- conversation never duplicates an attachment row.
create unique index if not exists lead_attachments_lead_path_key
  on public.lead_attachments (lead_id, storage_path);
create index if not exists lead_attachments_lead_idx
  on public.lead_attachments (lead_id, created_at desc);
create index if not exists lead_attachments_workspace_idx
  on public.lead_attachments (workspace_id, created_at desc);

-- workspace consistency: the lead, and any referenced message/conversation,
-- must all belong to the row's workspace. Same guard style as
-- crm_notes_validate_target / inbox_*_validate_workspace.
create or replace function public.lead_attachments_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.leads where id = new.lead_id and workspace_id = new.workspace_id
  ) then
    raise exception 'lead_attachments.workspace_id must match its lead''s workspace' using errcode = '23514';
  end if;

  if new.message_id is not null and not exists (
    select 1 from public.inbox_messages where id = new.message_id and workspace_id = new.workspace_id
  ) then
    raise exception 'lead_attachments.message_id must be a message in the same workspace' using errcode = '23514';
  end if;

  if new.conversation_id is not null and not exists (
    select 1 from public.inbox_conversations where id = new.conversation_id and workspace_id = new.workspace_id
  ) then
    raise exception 'lead_attachments.conversation_id must be a conversation in the same workspace' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists lead_attachments_validate_workspace_trg on public.lead_attachments;
create trigger lead_attachments_validate_workspace_trg
  before insert or update on public.lead_attachments
  for each row execute function public.lead_attachments_validate_workspace();

alter table public.lead_attachments enable row level security;

-- Read: any workspace member who can view leads. Signed-URL minting for
-- the actual file goes through leads-actions (lead.view + a re-check of
-- the attachment -> lead -> workspace chain), so a client never needs the
-- storage path itself.
drop policy if exists "lead_attachments_select" on public.lead_attachments;
create policy "lead_attachments_select"
on public.lead_attachments for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'lead.view'));

-- No authenticated INSERT/UPDATE/DELETE policy: every row is written by
-- leads-actions using the service role (which bypasses RLS), the same
-- backend-authoritative pattern as crm_notes and workspace_activity_log.

comment on table public.lead_attachments is
  'Phase 2: links a lead to a media object a customer already sent (currently WhatsApp inbound, inbox-media bucket). References the existing object - never a byte copy. Populated by leads-actions on conversation -> lead conversion / link. RLS: lead.view to read; all writes via the service role.';

-- Realtime so the lead Documents panel refreshes when the conversion runs.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_attachments'
  ) then
    alter publication supabase_realtime add table public.lead_attachments;
  end if;
end $$;
