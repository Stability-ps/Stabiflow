-- Phase D (WhatsApp Inbox + Conversations + AI/Human Control).
--
-- Ported from Acapolite Consulting's proven whatsapp_conversations/
-- whatsapp_messages/whatsapp_staff_actions/whatsapp_alerts/
-- whatsapp_conversation_reads schema (source implementation, read-only
-- reference - never modified, never pointed at from this project). See the
-- Phase D completion report for the full reuse/adapt/rewrite/leave-behind
-- classification. Structural changes from the source:
--
--   1. Every table gets workspace_id, and conversations additionally scope
--      through workspace_whatsapp_numbers (the Phase C per-workspace
--      number, not Acapolite's implicit single global number).
--      Uniqueness on (wa_id) becomes (whatsapp_number_id, wa_id) - two
--      DIFFERENT workspaces' numbers can each have their own conversation
--      with the same external phone number; that's two unrelated
--      conversations, not a collision.
--   2. RLS is has_workspace_permission()-based (inbox.view / inbox.manage),
--      not the source's single-tenant get_my_role()='admin'.
--   3. No separate whatsapp_staff_actions audit table - StabiFlow already
--      has workspace_activity_log shared across every module (Content,
--      Campaigns, Integrations), and the durable product principle is
--      explicit that Inbox must share it too, not fork its own audit
--      trail. Staff actions (assign/resolve/reopen/return_to_ai/reply)
--      are logged there instead.
--   4. The source's tax/SARS-specific priority-auto-escalation trigger
--      clause, intake question-ladder, and service_request bridge are
--      NOT ported - priority_level is staff-set only for V1; intake
--      tracking is a simple free-form summary, not a hardcoded field
--      schema; converting a conversation into a Lead/Opportunity belongs
--      to a later phase (the pipeline the durable architecture describes),
--      not this one.

-- 1. Fine-grained permissions --------------------------------------------------
-- Mirrors content.*/campaign.*/integration.* (Phase 5/6/C): inbox.view and
-- inbox.manage granted to exactly the same role set the existing coarse
-- manage_inbox permission already uses (owner/admin/manager/support) -
-- marketing/sales/viewer get neither, since inbox conversations carry
-- customer PII, unlike broadly-viewable marketing content.

insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'inbox.view'), ('owner', 'inbox.manage'),
  ('admin', 'inbox.view'), ('admin', 'inbox.manage'),
  ('manager', 'inbox.view'), ('manager', 'inbox.manage'),
  ('support', 'inbox.view'), ('support', 'inbox.manage')
on conflict (role, permission) do nothing;

-- 2. inbox_conversations --------------------------------------------------------

create table if not exists public.inbox_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  whatsapp_number_id uuid not null references public.workspace_whatsapp_numbers(id) on delete cascade,

  wa_id text not null, -- the customer's WhatsApp id (their phone number, Meta's format)
  phone_number text not null,
  display_name text,

  status text not null default 'active' check (status in ('active', 'human_handoff', 'closed')),
  ai_enabled boolean not null default true,
  human_handoff_requested_at timestamptz,

  inbox_status text not null default 'new' check (inbox_status in ('new', 'unassigned', 'assigned', 'waiting_client', 'resolved')),
  priority_level text not null default 'normal' check (priority_level in ('normal', 'high', 'urgent')),

  assigned_staff_id uuid references public.profiles(id) on delete set null,
  assigned_staff_name text,
  assigned_at timestamptz,
  assigned_by uuid references public.profiles(id) on delete set null,

  first_staff_reply_at timestamptz,
  last_staff_reply_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,

  -- Ad/campaign attribution Meta supplies on a click-to-WhatsApp referral -
  -- the exact hook the future Campaign -> Conversation connection needs
  -- (durable architecture: "Content/Campaign -> Ad/Creative -> WhatsApp
  -- Conversation"). Populated opportunistically; never fabricated when
  -- absent (no fake attribution).
  referral_source text,
  referral_campaign_id text,
  referral_ad_id text,
  referral_headline text,

  -- Free-form AI notes, deliberately NOT a hardcoded business field schema
  -- (see migration header) - a later phase can layer structured
  -- qualification on top without a schema migration here.
  ai_summary text,
  intake_payload jsonb not null default '{}'::jsonb,
  intake_missing_fields text[] not null default '{}'::text[],

  last_inbound_at timestamptz,
  last_outbound_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inbox_conversations_number_wa_id_key
  on public.inbox_conversations (whatsapp_number_id, wa_id);
create index if not exists inbox_conversations_workspace_idx
  on public.inbox_conversations (workspace_id, updated_at desc);
create index if not exists inbox_conversations_inbox_status_idx
  on public.inbox_conversations (workspace_id, inbox_status, priority_level, updated_at desc);
create index if not exists inbox_conversations_assigned_idx
  on public.inbox_conversations (assigned_staff_id, updated_at desc)
  where assigned_staff_id is not null;

drop trigger if exists set_inbox_conversations_updated_at on public.inbox_conversations;
create trigger set_inbox_conversations_updated_at before update on public.inbox_conversations
  for each row execute function public.set_updated_at();

create or replace function public.inbox_conversations_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_whatsapp_numbers
    where id = new.whatsapp_number_id and workspace_id = new.workspace_id
  ) then
    raise exception 'inbox_conversations.workspace_id must match its whatsapp_number_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists inbox_conversations_validate_workspace_trg on public.inbox_conversations;
create trigger inbox_conversations_validate_workspace_trg
  before insert or update on public.inbox_conversations
  for each row execute function public.inbox_conversations_validate_workspace();

-- 3. inbox_messages ---------------------------------------------------------------

create table if not exists public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,

  provider_message_id text, -- Meta's wamid - unique when present, null for a locally-saved-only message
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_type text not null check (sender_type in ('customer', 'ai', 'staff', 'system')),
  message_type text not null default 'text',
  content text,
  delivery_status text,

  media_id text,
  media_mime_type text,
  media_filename text,
  media_sha256 text,
  media_size_bytes integer,
  media_storage_path text,

  staff_sender_id uuid references public.profiles(id) on delete set null,
  staff_sender_name text,

  created_at timestamptz not null default now()
);

create unique index if not exists inbox_messages_provider_message_id_key
  on public.inbox_messages (provider_message_id)
  where provider_message_id is not null;
create index if not exists inbox_messages_conversation_idx
  on public.inbox_messages (conversation_id, created_at);
create index if not exists inbox_messages_workspace_idx
  on public.inbox_messages (workspace_id, created_at desc);

create or replace function public.inbox_messages_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.inbox_conversations
    where id = new.conversation_id and workspace_id = new.workspace_id
  ) then
    raise exception 'inbox_messages.workspace_id must match its conversation_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists inbox_messages_validate_workspace_trg on public.inbox_messages;
create trigger inbox_messages_validate_workspace_trg
  before insert or update on public.inbox_messages
  for each row execute function public.inbox_messages_validate_workspace();

-- 4. inbox_alerts / inbox_conversation_reads / inbox_internal_notes -----------------

create table if not exists public.inbox_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  alert_type text not null check (alert_type in ('human_handoff', 'customer_reply', 'high_priority', 'message_failed')),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  body text,
  message_id uuid references public.inbox_messages(id) on delete cascade,
  assigned_staff_id uuid references public.profiles(id) on delete set null,
  is_resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inbox_alerts_open_idx
  on public.inbox_alerts (workspace_id, is_resolved, severity, created_at desc);
create unique index if not exists inbox_alerts_unique_message_idx
  on public.inbox_alerts (alert_type, message_id)
  where message_id is not null;
create unique index if not exists inbox_alerts_unique_open_conversation_idx
  on public.inbox_alerts (alert_type, conversation_id)
  where message_id is null and is_resolved = false;

create table if not exists public.inbox_conversation_reads (
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, staff_id)
);

create table if not exists public.inbox_internal_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  body text not null check (length(trim(body)) between 1 and 2000),
  mentioned_staff_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now()
);

create index if not exists inbox_internal_notes_conversation_idx
  on public.inbox_internal_notes (conversation_id, created_at desc);

-- 5. RLS ------------------------------------------------------------------------

alter table public.inbox_conversations enable row level security;
alter table public.inbox_messages enable row level security;
alter table public.inbox_alerts enable row level security;
alter table public.inbox_conversation_reads enable row level security;
alter table public.inbox_internal_notes enable row level security;

drop policy if exists "inbox_conversations_select" on public.inbox_conversations;
create policy "inbox_conversations_select"
on public.inbox_conversations for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'inbox.view'));

drop policy if exists "inbox_conversations_write" on public.inbox_conversations;
create policy "inbox_conversations_write"
on public.inbox_conversations for update
to authenticated
using (public.has_workspace_permission(workspace_id, 'inbox.manage'))
with check (public.has_workspace_permission(workspace_id, 'inbox.manage'));
-- Deliberately no client-side INSERT/DELETE policy: conversations are only
-- ever created by the inbound webhook (service role, bypasses RLS) or
-- deleted never (V1 has no deletion flow) - mirrors "server creates,
-- staff manages" from the source implementation.

drop policy if exists "inbox_messages_select" on public.inbox_messages;
create policy "inbox_messages_select"
on public.inbox_messages for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'inbox.view'));
-- No authenticated INSERT policy: every message (inbound from the webhook,
-- outbound from a staff reply or the AI) is written by an edge function
-- using the service role after the caller's own permission was already
-- verified against their own session - identical shape to
-- content_publish_attempts/ad_publish_operations.

drop policy if exists "inbox_alerts_select" on public.inbox_alerts;
create policy "inbox_alerts_select"
on public.inbox_alerts for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'inbox.view'));

drop policy if exists "inbox_alerts_update" on public.inbox_alerts;
create policy "inbox_alerts_update"
on public.inbox_alerts for update
to authenticated
using (public.has_workspace_permission(workspace_id, 'inbox.manage'))
with check (public.has_workspace_permission(workspace_id, 'inbox.manage'));

drop policy if exists "inbox_conversation_reads_select" on public.inbox_conversation_reads;
create policy "inbox_conversation_reads_select"
on public.inbox_conversation_reads for select
to authenticated
using (exists (
  select 1 from public.inbox_conversations c
  where c.id = conversation_id and public.has_workspace_permission(c.workspace_id, 'inbox.view')
));

drop policy if exists "inbox_conversation_reads_upsert" on public.inbox_conversation_reads;
create policy "inbox_conversation_reads_upsert"
on public.inbox_conversation_reads for insert
to authenticated
with check (
  staff_id = auth.uid()
  and exists (
    select 1 from public.inbox_conversations c
    where c.id = conversation_id and public.has_workspace_permission(c.workspace_id, 'inbox.view')
  )
);

drop policy if exists "inbox_conversation_reads_own_update" on public.inbox_conversation_reads;
create policy "inbox_conversation_reads_own_update"
on public.inbox_conversation_reads for update
to authenticated
using (staff_id = auth.uid())
with check (staff_id = auth.uid());

drop policy if exists "inbox_internal_notes_select" on public.inbox_internal_notes;
create policy "inbox_internal_notes_select"
on public.inbox_internal_notes for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'inbox.view'));

drop policy if exists "inbox_internal_notes_insert" on public.inbox_internal_notes;
create policy "inbox_internal_notes_insert"
on public.inbox_internal_notes for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'inbox.manage') and author_id = auth.uid());

-- 6. State-machine triggers (ported, SARS-specific priority auto-escalation
--    clause NOT included - see migration header) ---------------------------------

create or replace function public.sync_inbox_conversation_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'human_handoff' and (old.status is distinct from 'human_handoff' or old.ai_enabled is distinct from false) then
    new.inbox_status := case when new.assigned_staff_id is null then 'new' else 'assigned' end;
    new.resolved_at := null;
    new.resolved_by := null;
  end if;

  if new.status = 'human_handoff' and new.assigned_staff_id is distinct from old.assigned_staff_id and new.inbox_status <> 'waiting_client' then
    new.inbox_status := case when new.assigned_staff_id is null then 'unassigned' else 'assigned' end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_inbox_conversation_state on public.inbox_conversations;
create trigger trg_sync_inbox_conversation_state
before update on public.inbox_conversations
for each row execute function public.sync_inbox_conversation_state();

create or replace function public.create_inbox_conversation_alerts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'human_handoff' and (old.status is distinct from 'human_handoff' or old.ai_enabled is distinct from false) then
    insert into public.inbox_alerts (workspace_id, conversation_id, alert_type, severity, title, body, assigned_staff_id)
    values (new.workspace_id, new.id, 'human_handoff', 'warning', 'New human handoff', coalesce(new.display_name, new.wa_id) || ' requested human assistance.', new.assigned_staff_id)
    on conflict do nothing;
  end if;

  if new.priority_level in ('high', 'urgent') and old.priority_level is distinct from new.priority_level then
    insert into public.inbox_alerts (workspace_id, conversation_id, alert_type, severity, title, body, assigned_staff_id)
    values (new.workspace_id, new.id, 'high_priority', 'critical', 'High-priority conversation', coalesce(new.display_name, new.wa_id) || ' was marked ' || new.priority_level || ' priority.', new.assigned_staff_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_create_inbox_conversation_alerts on public.inbox_conversations;
create trigger trg_create_inbox_conversation_alerts
after update on public.inbox_conversations
for each row execute function public.create_inbox_conversation_alerts();

create or replace function public.handle_inbox_message_operations()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_conversation public.inbox_conversations%rowtype;
begin
  select * into v_conversation from public.inbox_conversations where id = new.conversation_id;

  if new.direction = 'inbound' and v_conversation.status = 'human_handoff' and v_conversation.ai_enabled = false then
    update public.inbox_conversations
    set inbox_status = case when assigned_staff_id is null then 'unassigned' else 'assigned' end,
        updated_at = greatest(updated_at, new.created_at)
    where id = new.conversation_id and inbox_status <> 'resolved';

    insert into public.inbox_alerts (workspace_id, conversation_id, alert_type, severity, title, body, message_id, assigned_staff_id)
    values (new.workspace_id, new.conversation_id, 'customer_reply', 'info', 'Customer replied during human control', coalesce(v_conversation.display_name, v_conversation.wa_id) || ' sent a new message.', new.id, v_conversation.assigned_staff_id)
    on conflict do nothing;
  end if;

  if new.direction = 'outbound' and new.sender_type = 'staff' then
    update public.inbox_conversations
    set first_staff_reply_at = coalesce(first_staff_reply_at, new.created_at)
    where id = new.conversation_id;
  end if;

  if new.direction = 'outbound' and new.delivery_status = 'failed' then
    insert into public.inbox_alerts (workspace_id, conversation_id, alert_type, severity, title, body, message_id, assigned_staff_id)
    values (new.workspace_id, new.conversation_id, 'message_failed', 'critical', 'Message failed to send', 'A reply could not be delivered.', new.id, v_conversation.assigned_staff_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_handle_inbox_message_operations on public.inbox_messages;
create trigger trg_handle_inbox_message_operations
after insert on public.inbox_messages
for each row execute function public.handle_inbox_message_operations();

drop trigger if exists trg_inbox_message_delivery_alerts on public.inbox_messages;
create trigger trg_inbox_message_delivery_alerts
after update of delivery_status on public.inbox_messages
for each row
when (new.delivery_status = 'failed' and old.delivery_status is distinct from new.delivery_status)
execute function public.handle_inbox_message_operations();

-- 7. Private media storage (mirrors 20260826060300_content_storage.sql's
--    path-prefix-is-authoritative pattern) -------------------------------------

insert into storage.buckets (id, name, public)
values ('inbox-media', 'inbox-media', false)
on conflict (id) do update set public = excluded.public;

create or replace function public.inbox_storage_path_workspace_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

drop policy if exists "inbox_media_select_member" on storage.objects;
create policy "inbox_media_select_member"
on storage.objects for select
to authenticated
using (
  bucket_id = 'inbox-media'
  and public.has_workspace_permission(public.inbox_storage_path_workspace_id(name), 'inbox.view')
);
-- No authenticated INSERT/UPDATE/DELETE policy: every object in this
-- bucket is written by the inbound webhook using the service role, which
-- bypasses RLS - there is no legitimate client-side write to this bucket.

-- 8. Realtime (mirrors Acapolite's postgres_changes-driven live feed) -------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox_conversations'
  ) then
    alter publication supabase_realtime add table public.inbox_conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox_messages'
  ) then
    alter publication supabase_realtime add table public.inbox_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox_alerts'
  ) then
    alter publication supabase_realtime add table public.inbox_alerts;
  end if;
end
$$;
