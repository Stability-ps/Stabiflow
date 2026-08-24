-- Centralized workspace authorization. Every RLS policy on every
-- tenant-owned table calls one of these three functions rather than
-- re-deriving the membership/role predicate inline - see decision log in
-- docs/architecture/multi-tenancy.md. All three are STABLE + SECURITY
-- DEFINER with a locked search_path: STABLE so Postgres can cache the
-- result within one statement, SECURITY DEFINER so a policy on
-- workspace_members itself doesn't recursively re-trigger RLS when this
-- function reads that same table.

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  );
$$;

comment on function public.is_workspace_member(uuid) is
  'True if the current auth.uid() is any member of the given workspace, regardless of role.';

-- Explicit numeric seniority ranking, independent of the enum''s
-- declaration order. Marketing/sales/support are peers (specialist
-- roles), each below manager and above viewer.
create or replace function public.workspace_role_rank(p_role public.workspace_role)
returns integer
language sql
immutable
as $$
  select case p_role
    when 'owner' then 100
    when 'admin' then 90
    when 'manager' then 70
    when 'marketing' then 50
    when 'sales' then 50
    when 'support' then 50
    when 'viewer' then 10
  end;
$$;

create or replace function public.has_workspace_role(p_workspace_id uuid, p_min_role public.workspace_role)
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
      and public.workspace_role_rank(role) >= public.workspace_role_rank(p_min_role)
  );
$$;

comment on function public.has_workspace_role(uuid, public.workspace_role) is
  'True if the current auth.uid() has at least the seniority of p_min_role in the given workspace.';

-- Fine-grained permission matrix. Kept as a lookup table (not hardcoded in
-- the function body) specifically so new permissions/role grants are a
-- data change with an audit trail, not a function redeploy.
create table if not exists public.workspace_role_permissions (
  role public.workspace_role not null,
  permission text not null,
  primary key (role, permission)
);

insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'manage_workspace'), ('owner', 'manage_members'), ('owner', 'manage_billing'),
  ('owner', 'manage_integrations'), ('owner', 'manage_content'), ('owner', 'manage_campaigns'),
  ('owner', 'manage_inbox'), ('owner', 'manage_leads'), ('owner', 'manage_pipelines'), ('owner', 'view_analytics'),
  ('admin', 'manage_members'), ('admin', 'manage_integrations'), ('admin', 'manage_content'),
  ('admin', 'manage_campaigns'), ('admin', 'manage_inbox'), ('admin', 'manage_leads'),
  ('admin', 'manage_pipelines'), ('admin', 'view_analytics'),
  ('manager', 'manage_content'), ('manager', 'manage_campaigns'), ('manager', 'manage_inbox'),
  ('manager', 'manage_leads'), ('manager', 'manage_pipelines'), ('manager', 'view_analytics'),
  ('marketing', 'manage_content'), ('marketing', 'manage_campaigns'), ('marketing', 'view_analytics'),
  ('sales', 'manage_leads'), ('sales', 'view_analytics'),
  ('support', 'manage_inbox'), ('support', 'manage_leads'),
  ('viewer', 'view_analytics')
on conflict (role, permission) do nothing;

alter table public.workspace_role_permissions enable row level security;
drop policy if exists "workspace_role_permissions_read_all" on public.workspace_role_permissions;
create policy "workspace_role_permissions_read_all"
on public.workspace_role_permissions for select
to authenticated
using (true); -- the matrix itself isn't sensitive; per-workspace checks are what gate real data

create or replace function public.has_workspace_permission(p_workspace_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.workspace_role_permissions wrp on wrp.role = wm.role
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wrp.permission = p_permission
  );
$$;

comment on function public.has_workspace_permission(uuid, text) is
  'True if the current auth.uid()''s role in the given workspace is granted p_permission via workspace_role_permissions.';

-- Bootstrap RPC: creates a workspace AND its owner membership atomically.
-- Needed because "insert your own membership row" can''t be authorized by
-- is_workspace_member/has_workspace_role - there is no membership yet.
-- SECURITY DEFINER closes that chicken-and-egg gap in one audited place
-- instead of a permissive INSERT policy on workspace_members.
create or replace function public.create_workspace(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated to create a workspace' using errcode = '42501';
  end if;

  insert into public.workspaces (name, slug, created_by)
  values (p_name, p_slug, auth.uid())
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, auth.uid(), 'owner');

  insert into public.workspace_settings (workspace_id) values (v_workspace_id);
  insert into public.workspace_billing (workspace_id) values (v_workspace_id);

  return v_workspace_id;
end;
$$;

-- Bootstrap RPC: accepts an invitation and creates the membership
-- atomically. The invited user isn''t a member yet either, so this has
-- the same chicken-and-egg shape as create_workspace above.
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

  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (v_invitation.workspace_id, auth.uid(), v_invitation.role, v_invitation.invited_by)
  on conflict (workspace_id, user_id) do update set role = excluded.role;

  update public.workspace_invitations
  set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  where id = v_invitation.id;

  return v_invitation.workspace_id;
end;
$$;
