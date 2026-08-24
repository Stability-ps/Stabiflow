-- Provider connections. workspace_integrations represents ONE connection
-- to a provider (Meta, WhatsApp) - it never stores the raw token, only a
-- pointer into Supabase Vault (verified on this project: only `postgres`
-- and `service_role` can SELECT vault.secrets/vault.decrypted_secrets -
-- `anon`/`authenticated` have no grant at all, so a decrypted token can
-- never reach the browser even via a client-side bug).
--
-- Kept deliberately separate from what the integration grants access TO:
-- a workspace can have one Meta integration but several Facebook Pages,
-- Instagram accounts, and ad accounts connected through it - see the
-- workspace_facebook_pages / workspace_instagram_accounts /
-- workspace_meta_ad_accounts / workspace_whatsapp_numbers tables below.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'integration_provider') then
    create type public.integration_provider as enum ('meta', 'whatsapp');
  end if;
  if not exists (select 1 from pg_type where typname = 'integration_status') then
    create type public.integration_status as enum ('connected', 'disconnected', 'error');
  end if;
end
$$;

create table if not exists public.workspace_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider public.integration_provider not null,
  status public.integration_status not null default 'disconnected',
  -- Pointer into vault.secrets, never the raw token. Populated/rotated only
  -- via set_workspace_integration_secret() below.
  vault_secret_id uuid references vault.secrets(id) on delete set null,
  last_health_check_at timestamptz,
  last_health_check_status text,
  last_health_check_message text,
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live integration per (workspace, provider) - reconnecting rotates
-- the same row's secret rather than creating a duplicate.
create unique index if not exists workspace_integrations_workspace_provider_key
  on public.workspace_integrations (workspace_id, provider);

drop trigger if exists set_workspace_integrations_updated_at on public.workspace_integrations;
create trigger set_workspace_integrations_updated_at before update on public.workspace_integrations
  for each row execute function public.set_updated_at();

alter table public.workspace_integrations enable row level security;

-- Even for an admin, the row itself never carries the decrypted secret -
-- select is safe to allow at "admin manages this workspace" granularity.
drop policy if exists "workspace_integrations_select_admin" on public.workspace_integrations;
create policy "workspace_integrations_select_admin"
on public.workspace_integrations for select
to authenticated
using (public.has_workspace_role(workspace_id, 'admin'));

drop policy if exists "workspace_integrations_write_admin" on public.workspace_integrations;
create policy "workspace_integrations_write_admin"
on public.workspace_integrations for all
to authenticated
using (public.has_workspace_role(workspace_id, 'admin'))
with check (public.has_workspace_role(workspace_id, 'admin'));

-- Secret read/write: SECURITY DEFINER, and EXECUTE is revoked from
-- anon/authenticated below - only code holding the service role key
-- (edge functions) can ever call these, exactly like Acapolite's existing
-- server-only META_ACCESS_TOKEN/WHATSAPP_ACCESS_TOKEN handling, just
-- per-workspace instead of one shared env var.

create or replace function public.set_workspace_integration_secret(p_integration_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_existing_secret_id uuid;
  v_new_secret_id uuid;
begin
  select vault_secret_id into v_existing_secret_id
  from public.workspace_integrations where id = p_integration_id;

  if v_existing_secret_id is not null then
    perform vault.update_secret(v_existing_secret_id, p_secret);
  else
    v_new_secret_id := vault.create_secret(p_secret, 'workspace_integration:' || p_integration_id::text);
    update public.workspace_integrations
    set vault_secret_id = v_new_secret_id
    where id = p_integration_id;
  end if;
end;
$$;

create or replace function public.get_workspace_integration_secret(p_integration_id uuid)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select ds.decrypted_secret
  from public.workspace_integrations wi
  join vault.decrypted_secrets ds on ds.id = wi.vault_secret_id
  where wi.id = p_integration_id;
$$;

revoke execute on function public.set_workspace_integration_secret(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_workspace_integration_secret(uuid) from public, anon, authenticated;
grant execute on function public.set_workspace_integration_secret(uuid, text) to service_role;
grant execute on function public.get_workspace_integration_secret(uuid) to service_role;

-- workspace_facebook_pages ----------------------------------------------------

create table if not exists public.workspace_facebook_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.workspace_integrations(id) on delete cascade,
  page_id text not null,
  page_name text not null,
  is_active boolean not null default true,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_facebook_pages_page_id_key on public.workspace_facebook_pages (page_id);
create index if not exists workspace_facebook_pages_workspace_idx on public.workspace_facebook_pages (workspace_id);

drop trigger if exists set_workspace_facebook_pages_updated_at on public.workspace_facebook_pages;
create trigger set_workspace_facebook_pages_updated_at before update on public.workspace_facebook_pages
  for each row execute function public.set_updated_at();

-- workspace_instagram_accounts -------------------------------------------------

create table if not exists public.workspace_instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.workspace_integrations(id) on delete cascade,
  ig_business_account_id text not null,
  username text,
  linked_facebook_page_id uuid references public.workspace_facebook_pages(id) on delete set null,
  is_active boolean not null default true,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_instagram_accounts_ig_id_key on public.workspace_instagram_accounts (ig_business_account_id);
create index if not exists workspace_instagram_accounts_workspace_idx on public.workspace_instagram_accounts (workspace_id);

drop trigger if exists set_workspace_instagram_accounts_updated_at on public.workspace_instagram_accounts;
create trigger set_workspace_instagram_accounts_updated_at before update on public.workspace_instagram_accounts
  for each row execute function public.set_updated_at();

-- workspace_meta_ad_accounts ----------------------------------------------------

create table if not exists public.workspace_meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.workspace_integrations(id) on delete cascade,
  ad_account_id text not null,
  name text,
  currency text,
  is_active boolean not null default true,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_meta_ad_accounts_ad_account_id_key on public.workspace_meta_ad_accounts (ad_account_id);
create index if not exists workspace_meta_ad_accounts_workspace_idx on public.workspace_meta_ad_accounts (workspace_id);

drop trigger if exists set_workspace_meta_ad_accounts_updated_at on public.workspace_meta_ad_accounts;
create trigger set_workspace_meta_ad_accounts_updated_at before update on public.workspace_meta_ad_accounts
  for each row execute function public.set_updated_at();

-- workspace_whatsapp_numbers ------------------------------------------------------
-- phone_number_id is globally unique (Meta-assigned) and is exactly the
-- webhook routing key: an inbound WhatsApp webhook carries this id, and
-- looking it up here is how a multi-tenant webhook finds "which workspace".

create table if not exists public.workspace_whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.workspace_integrations(id) on delete cascade,
  phone_number_id text not null,
  display_phone_number text,
  is_active boolean not null default true,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_whatsapp_numbers_phone_number_id_key on public.workspace_whatsapp_numbers (phone_number_id);
create index if not exists workspace_whatsapp_numbers_workspace_idx on public.workspace_whatsapp_numbers (workspace_id);

drop trigger if exists set_workspace_whatsapp_numbers_updated_at on public.workspace_whatsapp_numbers;
create trigger set_workspace_whatsapp_numbers_updated_at before update on public.workspace_whatsapp_numbers
  for each row execute function public.set_updated_at();

-- RLS: identical member-select / admin-write shape across all four
-- provider-resource tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_facebook_pages', 'workspace_instagram_accounts',
    'workspace_meta_ad_accounts', 'workspace_whatsapp_numbers'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %I on public.%I;', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id));',
      t || '_select_member', t
    );

    execute format('drop policy if exists %I on public.%I;', t || '_write_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.has_workspace_role(workspace_id, ''admin'')) with check (public.has_workspace_role(workspace_id, ''admin''));',
      t || '_write_admin', t
    );
  end loop;
end
$$;
