-- enforce_workspace_team_seats (20261002003000) is shared by the
-- workspace_members AND workspace_invitations triggers. Its "this member is
-- redeeming a pending invitation, don't count them twice" check was written
-- as ONE expression:
--
--   if tg_table_name = 'workspace_members' and exists (... new.user_id ...)
--
-- PL/pgSQL prepares the whole expression, so new.user_id is resolved even
-- for an invitation row - which has no user_id. Every pending-invitation
-- INSERT on a workspace with a finite team_seats limit (every real plan)
-- failed with: record "new" has no field "user_id". Inviting team members
-- was broken; production has no invitation created since 2026-08-30.
--
-- Same function, same rules; the members-only check is nested so it is
-- only ever planned for workspace_members rows. Invitations a caller may not
-- create, or that duplicate a pending one, are left to RLS / the unique index
-- so the user sees the real reason instead of "seat limit".
create or replace function public.enforce_workspace_team_seats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ent record;
  v_members bigint;
  v_pending bigint;
  v_increment integer := 1;
begin
  select e.* into v_ent
  from public._workspace_entitlements(new.workspace_id) as e
  where e.entitlement_key = 'team_seats';

  if not found or not v_ent.enabled then
    raise exception 'Your current plan does not include team seats' using errcode = 'P0001';
  end if;

  if v_ent.unlimited then
    return new;
  end if;

  if tg_table_name = 'workspace_invitations' then
    -- BEFORE triggers run ahead of RLS WITH CHECK and unique indexes, so
    -- without these two early exits a caller who may not invite at this
    -- role, or who repeats an existing pending invitation, was told
    -- "team-seat limit" on a full plan. Deferring lets the real reason
    -- surface (RLS 42501 / pending-unique 23505); the row is refused either
    -- way. Service-role inserts (auth.uid() null) are still seat-checked.
    if auth.uid() is not null and not public.can_grant_workspace_role(new.workspace_id, new.role) then
      return new;
    end if;
    if exists (
      select 1 from public.workspace_invitations wi
      where wi.workspace_id = new.workspace_id and wi.status = 'pending' and lower(wi.email) = lower(new.email)
    ) then
      return new;
    end if;
  end if;

  select count(*) into v_members
  from public.workspace_members
  where workspace_id = new.workspace_id;

  select count(*) into v_pending
  from public.workspace_invitations
  where workspace_id = new.workspace_id
    and status = 'pending'
    and expires_at > now();

  if tg_table_name = 'workspace_members' then
    -- Accepting a pending invitation converts an already-counted seat.
    if exists (
      select 1
      from public.workspace_invitations wi
      join auth.users au on lower(au.email) = lower(wi.email)
      where wi.workspace_id = new.workspace_id
        and wi.status = 'pending'
        and wi.expires_at > now()
        and au.id = new.user_id
    ) then
      v_increment := 0;
    end if;
  end if;

  if v_members + v_pending + v_increment > v_ent.limit_value then
    raise exception 'Your workspace has reached its team-seat limit. Upgrade your plan to add another member.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
