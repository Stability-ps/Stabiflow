-- Row Level Security for the workspace core tables. Every policy is built
-- from is_workspace_member()/has_workspace_role() (20260824060200) rather
-- than an inline membership subquery, so the tenant boundary is defined
-- in exactly one audited place.

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.workspace_billing enable row level security;

-- profiles --------------------------------------------------------------
-- A user can always see/update their own profile, and can see the
-- profiles of people who share at least one workspace with them (needed
-- to render member lists, "invited by", assignee pickers, etc.).

drop policy if exists "profiles_select_own_or_workspace_peer" on public.profiles;
create policy "profiles_select_own_or_workspace_peer"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs
      on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- workspaces --------------------------------------------------------------
-- No direct INSERT policy: workspaces are only created via
-- public.create_workspace(), which is SECURITY DEFINER and inserts the
-- owner membership in the same transaction.

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
on public.workspaces for select
to authenticated
using (public.is_workspace_member(id));

drop policy if exists "workspaces_update_owner_admin" on public.workspaces;
create policy "workspaces_update_owner_admin"
on public.workspaces for update
to authenticated
using (public.has_workspace_role(id, 'admin'))
with check (public.has_workspace_role(id, 'admin'));

drop policy if exists "workspaces_delete_owner" on public.workspaces;
create policy "workspaces_delete_owner"
on public.workspaces for delete
to authenticated
using (public.has_workspace_role(id, 'owner'));

-- workspace_members ---------------------------------------------------------
-- No direct INSERT policy here either - membership rows are only created
-- via create_workspace() (the owner row) or accept_workspace_invitation()
-- (every other row), both SECURITY DEFINER. This is deliberate: it means
-- "how does someone become a member" has exactly two audited code paths,
-- never a raw client-side insert.

drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member"
on public.workspace_members for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_members_update_admin" on public.workspace_members;
create policy "workspace_members_update_admin"
on public.workspace_members for update
to authenticated
using (public.has_workspace_role(workspace_id, 'admin'))
with check (public.has_workspace_role(workspace_id, 'admin'));

drop policy if exists "workspace_members_delete_admin" on public.workspace_members;
create policy "workspace_members_delete_admin"
on public.workspace_members for delete
to authenticated
using (public.has_workspace_role(workspace_id, 'admin'));

-- workspace_invitations -------------------------------------------------------
-- Admins manage invitations directly; acceptance goes through
-- accept_workspace_invitation() (SECURITY DEFINER) since the invitee
-- isn't a member yet and can't satisfy is_workspace_member().

drop policy if exists "workspace_invitations_select_admin" on public.workspace_invitations;
create policy "workspace_invitations_select_admin"
on public.workspace_invitations for select
to authenticated
using (public.has_workspace_role(workspace_id, 'admin'));

drop policy if exists "workspace_invitations_insert_admin" on public.workspace_invitations;
create policy "workspace_invitations_insert_admin"
on public.workspace_invitations for insert
to authenticated
with check (public.has_workspace_role(workspace_id, 'admin'));

drop policy if exists "workspace_invitations_update_admin" on public.workspace_invitations;
create policy "workspace_invitations_update_admin"
on public.workspace_invitations for update
to authenticated
using (public.has_workspace_role(workspace_id, 'admin'))
with check (public.has_workspace_role(workspace_id, 'admin'));

drop policy if exists "workspace_invitations_delete_admin" on public.workspace_invitations;
create policy "workspace_invitations_delete_admin"
on public.workspace_invitations for delete
to authenticated
using (public.has_workspace_role(workspace_id, 'admin'));

-- workspace_settings ----------------------------------------------------------

drop policy if exists "workspace_settings_select_member" on public.workspace_settings;
create policy "workspace_settings_select_member"
on public.workspace_settings for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_settings_update_admin" on public.workspace_settings;
create policy "workspace_settings_update_admin"
on public.workspace_settings for update
to authenticated
using (public.has_workspace_role(workspace_id, 'admin'))
with check (public.has_workspace_role(workspace_id, 'admin'));

-- workspace_billing -------------------------------------------------------------

drop policy if exists "workspace_billing_select_member" on public.workspace_billing;
create policy "workspace_billing_select_member"
on public.workspace_billing for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_billing_update_owner" on public.workspace_billing;
create policy "workspace_billing_update_owner"
on public.workspace_billing for update
to authenticated
using (public.has_workspace_role(workspace_id, 'owner'))
with check (public.has_workspace_role(workspace_id, 'owner'));
