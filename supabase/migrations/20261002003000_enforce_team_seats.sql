-- Enforce the team_seats entitlement at the database boundary.
-- Pending invitations reserve a seat so clients cannot over-invite and then
-- bypass the plan when several invitations are accepted later.

create or replace function public.enforce_workspace_team_seats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ent record;
  v_members bigint;
  v_pending bigint;
begin
  select * into v_ent
  from public._workspace_entitlements(new.workspace_id)
  where entitlement_key = 'team_seats';

  if v_ent is null or not v_ent.enabled then
    raise exception 'Your current plan does not include team seats' using errcode = 'P0001';
  end if;

  if v_ent.unlimited then
    return new;
  end if;

  select count(*) into v_members
  from public.workspace_members
  where workspace_id = new.workspace_id;

  select count(*) into v_pending
  from public.workspace_invitations
  where workspace_id = new.workspace_id
    and status = 'pending'
    and expires_at > now()
    and (tg_table_name <> 'workspace_members' or accepted_by is distinct from new.user_id);

  if tg_table_name = 'workspace_members' then
    -- accept_workspace_invitation inserts the membership before marking its
    -- invitation accepted. Exclude the invitation belonging to this user so
    -- the same seat is not counted twice during acceptance.
    if v_members + v_pending + 1 > v_ent.limit_value then
      raise exception 'Your workspace has reached its team-seat limit. Upgrade your plan to add another member.' using errcode = 'P0001';
    end if;
  else
    if v_members + v_pending + 1 > v_ent.limit_value then
      raise exception 'Your workspace has reached its team-seat limit. Upgrade your plan to invite another member.' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists workspace_members_team_seats_trg on public.workspace_members;
create trigger workspace_members_team_seats_trg
before insert on public.workspace_members
for each row execute function public.enforce_workspace_team_seats();

drop trigger if exists workspace_invitations_team_seats_trg on public.workspace_invitations;
create trigger workspace_invitations_team_seats_trg
before insert on public.workspace_invitations
for each row
when (new.status = 'pending')
execute function public.enforce_workspace_team_seats();

revoke execute on function public.enforce_workspace_team_seats() from public, anon, authenticated;
grant execute on function public.enforce_workspace_team_seats() to service_role;
