-- Launch-completion, security fix. profiles_update_own
-- (20260824060300_workspace_core_rls.sql) is a pre-existing row-level RLS
-- policy that lets any authenticated user update their OWN profile row -
-- written long before is_platform_operator existed, and RLS has no
-- column-level granularity, so that policy silently allowed a normal
-- authenticated user to set is_platform_operator=true on themselves via
-- a plain client UPDATE. Confirmed as a real, exploitable gap by a
-- release-blocker regression test
-- (supabase/tests/operator-and-suspension.test.ts) before this fix - the
-- self-promotion attempt actually succeeded.
--
-- Same fix shape as workspace_billing_protect_status
-- (20260914060000_workspace_status_and_platform_operator.sql): a BEFORE
-- UPDATE trigger rejects any change to is_platform_operator unless the
-- caller is service_role. Every other profile column (full_name, etc.)
-- remains self-editable exactly as before.
create or replace function public.profiles_protect_platform_operator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.is_platform_operator is distinct from old.is_platform_operator then
    raise exception 'profiles.is_platform_operator can only be changed by a platform operator' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_platform_operator_trg on public.profiles;
create trigger profiles_protect_platform_operator_trg
  before update on public.profiles
  for each row execute function public.profiles_protect_platform_operator();
