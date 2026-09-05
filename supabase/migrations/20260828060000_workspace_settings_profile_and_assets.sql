-- Phase B: workspace business-profile fields, a private storage bucket for
-- workspace-level assets (logo), and a slug-availability check.
--
-- Business-profile fields are added as real, normalized columns on
-- workspace_settings (not folded into the existing terminology/
-- feature_flags jsonb columns) - those two are jsonb specifically because
-- their shape is genuinely open-ended (arbitrary per-workspace terminology
-- overrides, arbitrary feature flags); logo/description/website/currency/
-- industry/contact are a fixed, known shape and belong as columns per the
-- project's "prefer normalized tables" convention.

alter table public.workspace_settings
  add column if not exists logo_path text,
  add column if not exists business_description text check (business_description is null or length(business_description) <= 2000),
  add column if not exists website text check (website is null or length(website) <= 500),
  add column if not exists currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  add column if not exists industry text check (industry is null or length(industry) <= 200),
  add column if not exists contact_email text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column if not exists contact_phone text check (contact_phone is null or length(contact_phone) <= 50);

-- workspace-assets storage bucket ------------------------------------------
-- Same private + path-prefix-is-the-workspace-id pattern as content-media
-- (20260826060300_content_storage.sql), gated on workspace admin role
-- (a logo/branding change is a workspace-profile-level action, not a
-- content.*/media.* permission) rather than a fine-grained permission -
-- matches workspace_settings' own RLS (admin-only update).

insert into storage.buckets (id, name, public)
values ('workspace-assets', 'workspace-assets', false)
on conflict (id) do update set public = excluded.public;

create or replace function public.workspace_assets_path_workspace_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

drop policy if exists "workspace_assets_select_member" on storage.objects;
create policy "workspace_assets_select_member"
on storage.objects for select
to authenticated
using (
  bucket_id = 'workspace-assets'
  and public.is_workspace_member(public.workspace_assets_path_workspace_id(name))
);

drop policy if exists "workspace_assets_insert_admin" on storage.objects;
create policy "workspace_assets_insert_admin"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'workspace-assets'
  and public.has_workspace_role(public.workspace_assets_path_workspace_id(name), 'admin')
);

drop policy if exists "workspace_assets_delete_admin" on storage.objects;
create policy "workspace_assets_delete_admin"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'workspace-assets'
  and public.has_workspace_role(public.workspace_assets_path_workspace_id(name), 'admin')
);

-- Slug availability check ---------------------------------------------------
-- workspaces SELECT is member-only ("workspaces_select_member" RLS), so a
-- client can't check "is this slug already taken by ANY workspace" via a
-- normal query - only membership-visible rows. SECURITY DEFINER, but
-- returns nothing except a boolean, so it can't be used to enumerate or
-- infer anything about workspaces the caller doesn't belong to.
create or replace function public.is_workspace_slug_available(p_slug text, p_exclude_workspace_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.workspaces
    where slug = p_slug
      and (p_exclude_workspace_id is null or id <> p_exclude_workspace_id)
  );
$$;

revoke execute on function public.is_workspace_slug_available(text, uuid) from public, anon;
grant execute on function public.is_workspace_slug_available(text, uuid) to authenticated;
