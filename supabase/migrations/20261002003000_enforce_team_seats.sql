-- Enforce the team_seats entitlement at the database boundary.
-- Pending invitations reserve a seat so clients cannot over-invite and then
-- bypass the plan when several invitations are accepted later.

create or replace function public.enforce_workspace_team_seats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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

  select count(*) into v_members
  from public.workspace_members
  where workspace_id = new.workspace_id;

  select count(*) into v_pending
  from public.workspace_invitations
  where workspace_id = new.workspace_id
    and status = 'pending'
    and expires_at > now();

  if tg_table_name = 'workspace_members' and exists (
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

  if v_members + v_pending + v_increment > v_ent.limit_value then
    raise exception 'Your workspace has reached its team-seat limit. Upgrade your plan to add another member.' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

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
