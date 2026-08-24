-- Closes a real privilege-escalation gap found during the Phase 4
-- security audit: workspace_members_update_admin and
-- workspace_invitations_insert_admin/update_admin only checked "is the
-- caller an admin of this workspace" - they never compared the caller's
-- own seniority against the role being GRANTED or the role of the member
-- being MODIFIED. Under the old policies, any admin (rank 90) could
-- UPDATE their own workspace_members row to role='owner' (rank 100), or
-- send themselves/an accomplice an invitation offering 'owner'. Neither
-- required outranking anyone.
--
-- Two new predicates close this, used everywhere a role is read or
-- written from here on:
--   can_manage_member_with_role(workspace_id, current_role) - "can the
--     caller touch a member who currently holds current_role" - used in
--     USING clauses (which see the OLD row on UPDATE/DELETE).
--   can_grant_workspace_role(workspace_id, new_role) - "can the caller
--     set someone's role TO new_role" - used in WITH CHECK clauses
--     (which see the NEW row on INSERT/UPDATE).
-- Both require strict outranking of the role in question (never equal),
-- which has a useful side effect: a caller can never satisfy
-- can_manage_member_with_role for their OWN row (caller_rank > caller_rank
-- is never true), so this also closes self-promotion AND self-demotion/
-- self-removal through the generic admin path in one rule, without a
-- special case. And 'owner' can only ever be granted by an existing owner.

create or replace function public.can_manage_member_with_role(p_workspace_id uuid, p_current_role public.workspace_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = auth.uid()
      and public.workspace_role_rank(role) >= public.workspace_role_rank('admin'::public.workspace_role)
      and public.workspace_role_rank(role) > public.workspace_role_rank(p_current_role)
  );
$$;

comment on function public.can_manage_member_with_role(uuid, public.workspace_role) is
  'True only if the caller is admin-or-above AND strictly outranks p_current_role - the role the target member currently holds. A caller can never satisfy this for their own row (their rank can''t exceed itself), which is deliberate: role changes to yourself, including self-promotion, never pass through the generic member-management path.';

create or replace function public.can_grant_workspace_role(p_workspace_id uuid, p_new_role public.workspace_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = auth.uid()
      and public.workspace_role_rank(role) >= public.workspace_role_rank('admin'::public.workspace_role)
      and public.workspace_role_rank(role) >= public.workspace_role_rank(p_new_role)
      and (p_new_role <> 'owner'::public.workspace_role or role = 'owner'::public.workspace_role)
  );
$$;

comment on function public.can_grant_workspace_role(uuid, public.workspace_role) is
  'True only if the caller is admin-or-above, is at least as senior as p_new_role (can never grant a role above their own), and - as a hard rule independent of rank - can only grant ''owner'' if the caller is already an owner.';

-- workspace_members: UPDATE/DELETE now gated on the CURRENT role of the
-- row being touched, and UPDATE additionally gates the NEW role.
drop policy if exists "workspace_members_update_admin" on public.workspace_members;
create policy "workspace_members_update_admin"
on public.workspace_members for update
to authenticated
using (public.can_manage_member_with_role(workspace_id, role))
with check (public.can_grant_workspace_role(workspace_id, role));

drop policy if exists "workspace_members_delete_admin" on public.workspace_members;
create policy "workspace_members_delete_admin"
on public.workspace_members for delete
to authenticated
using (public.can_manage_member_with_role(workspace_id, role));

-- workspace_invitations: creating/editing an invitation now goes through
-- the same "can the caller actually grant this role" check, so an admin
-- can no longer invite someone in as 'owner'.
drop policy if exists "workspace_invitations_insert_admin" on public.workspace_invitations;
create policy "workspace_invitations_insert_admin"
on public.workspace_invitations for insert
to authenticated
with check (public.can_grant_workspace_role(workspace_id, role));

drop policy if exists "workspace_invitations_update_admin" on public.workspace_invitations;
create policy "workspace_invitations_update_admin"
on public.workspace_invitations for update
to authenticated
using (public.has_workspace_role(workspace_id, 'admin')) -- any admin may revoke/edit status
with check (public.can_grant_workspace_role(workspace_id, role)); -- but re-targeting the role still can't exceed the caller's own grant

-- accept_workspace_invitation: closes a time-of-check/time-of-use gap -
-- an 'owner' invitation is only honoured if the ORIGINAL inviter still
-- currently holds 'owner' at the moment of acceptance, not just at the
-- moment the invitation was created (their role could have been changed
-- or removed in between).
create or replace function public.accept_workspace_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.workspace_invitations;
  v_caller_email text;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated to accept an invitation' using errcode = '42501';
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();

  select * into v_invitation
  from public.workspace_invitations
  where token = p_token and status = 'pending'
  for update;

  if v_invitation.id is null then
    raise exception 'Invitation not found or already used' using errcode = 'P0002';
  end if;

  if v_invitation.expires_at < now() then
    update public.workspace_invitations set status = 'expired' where id = v_invitation.id;
    raise exception 'Invitation has expired' using errcode = 'P0002';
  end if;

  if lower(v_invitation.email) <> lower(coalesce(v_caller_email, '')) then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  if v_invitation.role = 'owner'::public.workspace_role then
    if not exists (
      select 1 from public.workspace_members
      where workspace_id = v_invitation.workspace_id
        and user_id = v_invitation.invited_by
        and role = 'owner'::public.workspace_role
    ) then
      update public.workspace_invitations set status = 'revoked' where id = v_invitation.id;
      raise exception 'This owner invitation is no longer valid' using errcode = '42501';
    end if;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (v_invitation.workspace_id, auth.uid(), v_invitation.role, v_invitation.invited_by)
  on conflict (workspace_id, user_id) do update set role = excluded.role;

  update public.workspace_invitations
  set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  where id = v_invitation.id;

  return v_invitation.workspace_id;
end;
$$;

-- Hygiene: set_updated_at isn't SECURITY DEFINER (no privilege-escalation
-- vector - it runs as the invoking role), but pinning search_path on
-- every function in this schema, not just the ones that strictly require
-- it, avoids the question ever having to be re-asked per function later.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
