-- Workspace core: the tenant boundary every other StabiFlow table hangs
-- off. See _shared architecture note in docs/architecture/multi-tenancy.md
-- for why this shape was chosen over a single global role column (the
-- Acapolite pattern this product deliberately does not copy).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'workspace_role') then
    -- Ordered loosely most-senior to least; the actual seniority ranking
    -- used by has_workspace_role() lives in workspace_role_rank() below,
    -- not in this declaration order (enum order is not a safe thing to
    -- depend on for authorization logic).
    create type public.workspace_role as enum ('owner', 'admin', 'manager', 'marketing', 'sales', 'support', 'viewer');
  end if;

  if not exists (select 1 from pg_type where typname = 'workspace_invitation_status') then
    create type public.workspace_invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
  end if;
end
$$;

-- profiles ------------------------------------------------------------------
-- Deliberately NOT workspace-scoped: a person's display name/avatar doesn't
-- change depending on which workspace they're viewing, and one person can
-- belong to several workspaces (agency use case from the brief, section 41).

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row the moment someone signs up, mirroring the
-- Supabase-standard auth.users trigger pattern.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- workspaces ------------------------------------------------------------------

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();

-- workspace_members -----------------------------------------------------------

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'viewer',
  invited_by uuid references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_members_workspace_user_key
  on public.workspace_members (workspace_id, user_id);
create index if not exists workspace_members_user_idx on public.workspace_members (user_id);

drop trigger if exists set_workspace_members_updated_at on public.workspace_members;
create trigger set_workspace_members_updated_at before update on public.workspace_members
  for each row execute function public.set_updated_at();

-- workspace_invitations ---------------------------------------------------------

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.workspace_role not null default 'viewer',
  token uuid not null default gen_random_uuid(),
  status public.workspace_invitation_status not null default 'pending',
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists workspace_invitations_token_key on public.workspace_invitations (token);
create index if not exists workspace_invitations_workspace_idx on public.workspace_invitations (workspace_id, status);
-- One live pending invite per (workspace, email) - re-inviting should
-- update the existing row, not silently create a second live invitation.
create unique index if not exists workspace_invitations_pending_unique
  on public.workspace_invitations (workspace_id, email)
  where status = 'pending';

-- workspace_settings ------------------------------------------------------------

create table if not exists public.workspace_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  timezone text not null default 'Africa/Johannesburg',
  -- Lets a workspace call its pipeline entities "Request"/"Deal"/"Booking"/
  -- "Application" (brief section 24) without a schema change.
  terminology jsonb not null default '{}'::jsonb,
  feature_flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_workspace_settings_updated_at on public.workspace_settings;
create trigger set_workspace_settings_updated_at before update on public.workspace_settings
  for each row execute function public.set_updated_at();

-- workspace_billing (schema only - no billing logic yet, brief section 40) ------

create table if not exists public.workspace_billing (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  plan text not null default 'trial',
  limits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_workspace_billing_updated_at on public.workspace_billing;
create trigger set_workspace_billing_updated_at before update on public.workspace_billing
  for each row execute function public.set_updated_at();
