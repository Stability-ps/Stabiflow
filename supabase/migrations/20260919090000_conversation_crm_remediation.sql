-- Phase 2 remediation - senior review verdict REQUEST CHANGES on de5a780.
-- Applies only the approved review findings; no Phase-3 scope.
--
--   H1  a dedicated lead.attachment.view permission - lead.view is NOT
--       sufficient authority for raw customer WhatsApp documents.
--   M1  one lead per originating conversation, enforced in the database so
--       two simultaneous create_from_conversation calls cannot both win.
--   M3  lead_attachments bucket/path integrity, enforced by CHECK + trigger
--       so an invalid reference cannot be inserted even by future
--       service-role code (sign_lead_attachment signs with the service
--       role, so the row's path<->workspace tie must be guaranteed here).

-- 1. H1 - lead.attachment.view -----------------------------------------------
-- Same data-driven grant pattern as every other fine-grained permission
-- (20260824060200 / 20260901060000): a row in workspace_role_permissions,
-- never an implicit derivation from another permission.
--
-- Grant set, decided deliberately:
--   owner / admin / manager  - full CRM authority, already see everything
--   sales                    - owns leads day to day; opening a document a
--                              customer sent about their own deal is core work
--   support                  - YES: support already holds inbox.view +
--                              inbox.manage and handles these exact customer
--                              media objects in the Inbox today, so seeing
--                              the same file attached to the lead they are
--                              working is not new exposure
--   marketing / viewer       - NO: they have lead.view (list/detail) but NOT
--                              inbox.view, and must not receive raw customer
--                              documents. No implicit grant from lead.view.
insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'lead.attachment.view'),
  ('admin', 'lead.attachment.view'),
  ('manager', 'lead.attachment.view'),
  ('sales', 'lead.attachment.view'),
  ('support', 'lead.attachment.view')
on conflict (role, permission) do nothing;

-- Read of the attachment metadata rows moves to the same permission - the
-- Documents list and the signed-URL mint are now one authority, not two.
drop policy if exists "lead_attachments_select" on public.lead_attachments;
create policy "lead_attachments_select"
on public.lead_attachments for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'lead.attachment.view'));

comment on table public.lead_attachments is
  'Phase 2: links a lead to a media object a customer already sent (currently WhatsApp inbound, inbox-media bucket). References the existing object - never a byte copy. Populated by leads-actions on conversation -> lead conversion / link. RLS: lead.attachment.view to read; all writes via the service role; sign_lead_attachment re-resolves the full chain before minting a short-lived URL.';

-- 2. M1 - one lead per originating conversation ----------------------------
-- Replaces the non-unique lookup index from 20260901060000 with a partial
-- UNIQUE one. NULLs (every manually-created lead) are unconstrained; a
-- second convert of the same conversation raises 23505, which
-- create_from_conversation catches and turns into "adopt the canonical
-- lead and finish the idempotent completion path".
drop index if exists public.leads_conversation_idx;
create unique index if not exists leads_created_from_conversation_id_key
  on public.leads (created_from_conversation_id)
  where created_from_conversation_id is not null;

-- 3. M3 - lead_attachments bucket / path integrity ------------------------
alter table public.lead_attachments
  drop constraint if exists lead_attachments_storage_bucket_check;
alter table public.lead_attachments
  add constraint lead_attachments_storage_bucket_check
  check (storage_bucket = 'inbox-media');

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

  -- M3: the stored object path must itself resolve to this row's workspace.
  -- sign_lead_attachment signs with the service role (storage RLS bypassed),
  -- so this path<->workspace tie is the only thing standing between a
  -- lead.attachment.view user and a foreign tenant's file.
  if public.inbox_storage_path_workspace_id(new.storage_path) is distinct from new.workspace_id then
    raise exception 'lead_attachments.storage_path must resolve to the row''s workspace' using errcode = '23514';
  end if;

  -- When the row cites a specific source message, the path must be that
  -- message's own media - not some other object in the same workspace.
  if new.message_id is not null and not exists (
    select 1 from public.inbox_messages
    where id = new.message_id
      and workspace_id = new.workspace_id
      and media_storage_path = new.storage_path
  ) then
    raise exception 'lead_attachments.storage_path must match its source message''s media' using errcode = '23514';
  end if;

  return new;
end;
$$;
-- Trigger definition itself is unchanged (BEFORE INSERT OR UPDATE, from
-- 20260919080000) - only the function body is strengthened here.
