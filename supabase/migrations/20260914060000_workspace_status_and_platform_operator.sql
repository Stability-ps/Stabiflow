-- Launch-completion. Adds the minimum commercial-status foundation
-- (workspace_billing.status/trial_ends_at) and a platform-level operator
-- privilege (profiles.is_platform_operator) completely separate from
-- workspace_role. Neither is wired into Stripe/billing - this is
-- operational status only (can the workspace use the product right now),
-- and an internal support/admin surface, not a payment system.
--
-- is_platform_operator is deliberately NOT exposed through any RLS
-- bypass policy - every operator action goes through service-role edge
-- functions that check this flag server-side after authenticating the
-- caller, matching the existing service-role-only convention used by
-- clear_workspace_integration_secret and friends. There is no
-- client-reachable path to set this flag on your own profile.

alter table public.workspace_billing
  add column if not exists status text not null default 'trial'
    check (status in ('trial', 'active', 'suspended', 'cancelled')),
  add column if not exists trial_ends_at timestamptz;

-- SECURITY: workspace_billing already had an owner-UPDATE RLS policy
-- (workspace_billing_update_owner, 20260824060300_workspace_core_rls.sql)
-- from before status/trial_ends_at existed - written when the table had
-- nothing security-sensitive to protect. Left as-is, that policy would
-- let a SUSPENDED workspace's own owner silently un-suspend themselves
-- via a raw client PATCH request, which defeats the entire point of
-- suspension being operator-controlled. RLS policies can't compare
-- against OLD column values in a WITH CHECK clause, so the fix is a
-- BEFORE UPDATE trigger: any change to status/trial_ends_at is rejected
-- unless the caller is service_role (Supabase's service-role Postgres
-- role has BYPASSRLS, but triggers still fire for it regardless - this
-- trigger explicitly allows it through via auth.role(), and blocks every
-- other caller, including the workspace owner). Every other column
-- (plan, limits) remains owner-editable exactly as before.
create or replace function public.workspace_billing_protect_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.status is distinct from old.status or new.trial_ends_at is distinct from old.trial_ends_at then
    raise exception 'workspace_billing.status and trial_ends_at can only be changed by a platform operator' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_billing_protect_status_trg on public.workspace_billing;
create trigger workspace_billing_protect_status_trg
  before update on public.workspace_billing
  for each row execute function public.workspace_billing_protect_status();

alter table public.profiles
  add column if not exists is_platform_operator boolean not null default false;

-- Durable audit trail for every operator mutation (suspend/unsuspend
-- today, more later). Unlike platform_deletion_log this DOES reference
-- workspaces(id) - operator actions target still-existing workspaces,
-- not ones being deleted, so there's no "must survive deletion" tension
-- here; if a workspace is later deleted, its operator-action history
-- being cascade-removed with it is fine and expected.
create table if not exists public.platform_operator_actions (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references public.profiles(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists platform_operator_actions_workspace_idx
  on public.platform_operator_actions (workspace_id, created_at desc);

alter table public.platform_operator_actions enable row level security;
-- Service-role only - no client policy at all, matching workspace_deletion
-- and every other platform-internal table. Operator tooling reads/writes
-- this exclusively through edge functions that have already verified
-- profiles.is_platform_operator server-side.
