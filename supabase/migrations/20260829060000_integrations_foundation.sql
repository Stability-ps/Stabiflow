-- Phase C (Integrations) foundation. Builds on the Phase 3 schema
-- (workspace_integrations / workspace_facebook_pages /
-- workspace_instagram_accounts / workspace_meta_ad_accounts /
-- workspace_whatsapp_numbers) rather than replacing it - see instruction
-- #1 ("reuse this architecture, do not create duplicate provider-resource
-- models without a clear reason").
--
-- Five things this migration adds:
--   1. Fine-grained integration.* permissions (instruction #19), mirroring
--      the content.*/campaign.* pattern from Phase 5/6 - marketing/sales/
--      support are rank-peers, so who can view vs. connect vs. manage vs.
--      disconnect a provider has to be a named permission, not a role rank.
--   2. RLS on the five existing provider tables switched from
--      has_workspace_role('admin') to has_workspace_permission(), per
--      instruction #19 ("role rank is not an authorization substitute").
--      The admin/owner-only grant set is UNCHANGED for connect/manage/
--      disconnect - this is a mechanism change, not a behavior change.
--      workspace_integrations SELECT is deliberately broadened from
--      admin-only to integration.view (granted to every role, like
--      content.view/campaign.view) - the row never carries the decrypted
--      secret, so showing "Meta: connected" to a marketing/viewer member
--      is not a new information disclosure, just parity with how every
--      other module's coarse status is already member-readable.
--   3. Workspace-consistency triggers on the four resource tables
--      (instruction #21/#22): a row's integration_id must point at a
--      workspace_integrations row for the SAME workspace_id, and
--      workspace_instagram_accounts.linked_facebook_page_id must point at
--      a Page in the same workspace. Mirrors
--      content_platform_variants_validate_workspace() exactly.
--   4. New columns needed for the token-lifecycle and health-status model
--      (instruction #7/#16) - token_expires_at, last_success_at,
--      disconnected_at on workspace_integrations; waba_id/verified_name/
--      quality_rating/platform_status on workspace_whatsapp_numbers.
--      Deliberately NOT adding new integration_status enum values -
--      'connected'/'disconnected'/'error' stays the coarse "is there a
--      live connection" signal every existing Content/Campaigns edge
--      function already branches on, and the richer vocabulary (healthy,
--      needs_attention, token_expired, missing_permission, ...) lives in
--      the already-free-text last_health_check_status column, exactly per
--      instruction #16 ("use existing fields if sufficient").
--   5. Two new tables: workspace_integration_oauth_states (CSRF/replay
--      protection for the OAuth callback, instruction #29/#30) and
--      workspace_whatsapp_webhook_events (webhook idempotency, instruction
--      #15/#41). Both are service-role-only by omission of any
--      authenticated policy after enabling RLS - the standard "RLS
--      enabled, zero policies = nobody but service_role" default used
--      elsewhere in this schema for system-authored tables.

-- 1. Fine-grained permissions -------------------------------------------------

insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'integration.view'), ('owner', 'integration.connect'), ('owner', 'integration.manage'), ('owner', 'integration.disconnect'),
  ('admin', 'integration.view'), ('admin', 'integration.connect'), ('admin', 'integration.manage'), ('admin', 'integration.disconnect'),
  -- Below admin: view only. Connecting/managing/disconnecting a provider
  -- can break publishing or ad spend for the whole workspace, so it stays
  -- owner/admin-only exactly like the existing manage_integrations grant
  -- (kept, not removed - other code may still reference it).
  ('manager', 'integration.view'),
  ('marketing', 'integration.view'),
  ('sales', 'integration.view'),
  ('support', 'integration.view'),
  ('viewer', 'integration.view')
on conflict (role, permission) do nothing;

-- 2. RLS: role-rank -> permission-based --------------------------------------

drop policy if exists "workspace_integrations_select_admin" on public.workspace_integrations;
create policy "workspace_integrations_select_member"
on public.workspace_integrations for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'integration.view'));

drop policy if exists "workspace_integrations_write_admin" on public.workspace_integrations;
create policy "workspace_integrations_write_manage"
on public.workspace_integrations for all
to authenticated
using (public.has_workspace_permission(workspace_id, 'integration.manage'))
with check (public.has_workspace_permission(workspace_id, 'integration.manage'));

do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_facebook_pages', 'workspace_instagram_accounts',
    'workspace_meta_ad_accounts', 'workspace_whatsapp_numbers'
  ]
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_write_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.has_workspace_permission(workspace_id, ''integration.manage'')) with check (public.has_workspace_permission(workspace_id, ''integration.manage''));',
      t || '_write_manage', t
    );
  end loop;
end
$$;

-- 3. Workspace-consistency triggers -------------------------------------------

create or replace function public.workspace_facebook_pages_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_integrations
    where id = new.integration_id and workspace_id = new.workspace_id
  ) then
    raise exception 'workspace_facebook_pages.workspace_id must match its integration_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_facebook_pages_validate_workspace_trg on public.workspace_facebook_pages;
create trigger workspace_facebook_pages_validate_workspace_trg
  before insert or update on public.workspace_facebook_pages
  for each row execute function public.workspace_facebook_pages_validate_workspace();

create or replace function public.workspace_instagram_accounts_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_integrations
    where id = new.integration_id and workspace_id = new.workspace_id
  ) then
    raise exception 'workspace_instagram_accounts.workspace_id must match its integration_id''s workspace' using errcode = '23514';
  end if;
  if new.linked_facebook_page_id is not null and not exists (
    select 1 from public.workspace_facebook_pages
    where id = new.linked_facebook_page_id and workspace_id = new.workspace_id
  ) then
    raise exception 'workspace_instagram_accounts.linked_facebook_page_id must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_instagram_accounts_validate_workspace_trg on public.workspace_instagram_accounts;
create trigger workspace_instagram_accounts_validate_workspace_trg
  before insert or update on public.workspace_instagram_accounts
  for each row execute function public.workspace_instagram_accounts_validate_workspace();

create or replace function public.workspace_meta_ad_accounts_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_integrations
    where id = new.integration_id and workspace_id = new.workspace_id
  ) then
    raise exception 'workspace_meta_ad_accounts.workspace_id must match its integration_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_meta_ad_accounts_validate_workspace_trg on public.workspace_meta_ad_accounts;
create trigger workspace_meta_ad_accounts_validate_workspace_trg
  before insert or update on public.workspace_meta_ad_accounts
  for each row execute function public.workspace_meta_ad_accounts_validate_workspace();

create or replace function public.workspace_whatsapp_numbers_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_integrations
    where id = new.integration_id and workspace_id = new.workspace_id
  ) then
    raise exception 'workspace_whatsapp_numbers.workspace_id must match its integration_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_whatsapp_numbers_validate_workspace_trg on public.workspace_whatsapp_numbers;
create trigger workspace_whatsapp_numbers_validate_workspace_trg
  before insert or update on public.workspace_whatsapp_numbers
  for each row execute function public.workspace_whatsapp_numbers_validate_workspace();

-- 4. New columns ---------------------------------------------------------------

alter table public.workspace_integrations
  add column if not exists token_expires_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists disconnected_at timestamptz;

comment on column public.workspace_integrations.token_expires_at is
  'When the stored provider token expires, if the provider supplies an expiry (Meta long-lived user tokens: ~60 days). Null if unknown/non-expiring.';
comment on column public.workspace_integrations.last_success_at is
  'When a connection health check last PASSED - distinct from last_health_check_at, which updates on every check regardless of outcome.';
comment on column public.workspace_integrations.disconnected_at is
  'When this integration was last explicitly disconnected by a workspace admin/owner.';

alter table public.workspace_whatsapp_numbers
  add column if not exists waba_id text,
  add column if not exists verified_name text,
  add column if not exists quality_rating text,
  add column if not exists platform_status text;

comment on column public.workspace_whatsapp_numbers.waba_id is
  'The WhatsApp Business Account ID this phone number belongs to (Meta-assigned).';
comment on column public.workspace_whatsapp_numbers.quality_rating is
  'Meta-reported messaging quality rating for this number (e.g. GREEN/YELLOW/RED), where supplied.';
comment on column public.workspace_whatsapp_numbers.platform_status is
  'Meta-reported platform status for this number (e.g. CONNECTED, FLAGGED, RESTRICTED), where supplied.';

-- 5. OAuth state + webhook idempotency tables ---------------------------------

create table if not exists public.workspace_integration_oauth_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider public.integration_provider not null,
  state text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create unique index if not exists workspace_integration_oauth_states_state_key
  on public.workspace_integration_oauth_states (state);
create index if not exists workspace_integration_oauth_states_expires_idx
  on public.workspace_integration_oauth_states (expires_at);

alter table public.workspace_integration_oauth_states enable row level security;
-- No policies for authenticated/anon on purpose: the state value is a
-- CSRF/replay-protection secret (instruction #29) and is only ever
-- written/read by the oauth-start/oauth-callback edge functions using the
-- service role, which bypasses RLS entirely. A client should never be able
-- to read, forge, or reuse another session's state row.

create table if not exists public.workspace_whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  -- workspace_id/phone number resolution can fail (unknown number) - kept
  -- nullable so an unresolvable event is still recorded as a safe no-op
  -- (instruction #41) rather than being un-insertable.
  workspace_id uuid references public.workspaces(id) on delete cascade,
  phone_number_id text not null,
  provider_event_id text not null,
  event_type text not null, -- message | status | unknown
  received_at timestamptz not null default now(),
  payload_summary jsonb not null default '{}'::jsonb
);

-- The idempotency primitive (instruction #15/#41): the SAME provider event
-- id for the SAME phone number can only ever be inserted once. A retried
-- webhook delivery hits this unique constraint and is safely no-op'd by
-- the caller (ON CONFLICT DO NOTHING), never processed twice.
create unique index if not exists workspace_whatsapp_webhook_events_dedupe_key
  on public.workspace_whatsapp_webhook_events (phone_number_id, provider_event_id);
create index if not exists workspace_whatsapp_webhook_events_workspace_idx
  on public.workspace_whatsapp_webhook_events (workspace_id, received_at desc)
  where workspace_id is not null;

alter table public.workspace_whatsapp_webhook_events enable row level security;

drop policy if exists "workspace_whatsapp_webhook_events_select_member" on public.workspace_whatsapp_webhook_events;
create policy "workspace_whatsapp_webhook_events_select_member"
on public.workspace_whatsapp_webhook_events for select
to authenticated
using (workspace_id is not null and public.is_workspace_member(workspace_id));
-- No insert/update/delete policy for authenticated/anon: only the
-- whatsapp-webhook edge function (service role) ever writes these rows,
-- exactly like every other system-authored table in this schema.

-- Vault secret lifecycle: disconnect needs to be able to remove the raw
-- token from Vault (instruction #17 - "if provider tokens should be
-- deleted from Vault on disconnect, do so safely and document the
-- behavior": StabiFlow deletes it). Same access shape as
-- set_/get_workspace_integration_secret - SECURITY DEFINER, service_role
-- only.
create or replace function public.clear_workspace_integration_secret(p_integration_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select vault_secret_id into v_secret_id
  from public.workspace_integrations where id = p_integration_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
    update public.workspace_integrations set vault_secret_id = null where id = p_integration_id;
  end if;
end;
$$;

revoke execute on function public.clear_workspace_integration_secret(uuid) from public, anon, authenticated;
grant execute on function public.clear_workspace_integration_secret(uuid) to service_role;
