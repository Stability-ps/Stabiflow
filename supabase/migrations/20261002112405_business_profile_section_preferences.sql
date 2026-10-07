-- Recovered from production (supabase_migrations.schema_migrations,
-- version 20261002112405). It was applied directly to production and never
-- committed, so a fresh database was missing this table and My Business /
-- Business Studio 404'd locally. Same SQL, made re-runnable.
create table if not exists public.business_profile_section_preferences (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  section text not null check (section in ('location','social','team','projects','credentials')),
  status text not null default 'applicable' check (status in ('applicable','not_applicable')),
  reason text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, section)
);
alter table public.business_profile_section_preferences enable row level security;
grant select, insert, update, delete on public.business_profile_section_preferences to authenticated;

drop policy if exists "workspace members read profile section preferences" on public.business_profile_section_preferences;
create policy "workspace members read profile section preferences"
on public.business_profile_section_preferences for select to authenticated
using (exists (select 1 from public.workspace_members wm where wm.workspace_id = business_profile_section_preferences.workspace_id and wm.user_id = (select auth.uid())));

drop policy if exists "workspace admins manage profile section preferences" on public.business_profile_section_preferences;
create policy "workspace admins manage profile section preferences"
on public.business_profile_section_preferences for all to authenticated
using (exists (select 1 from public.workspace_members wm where wm.workspace_id = business_profile_section_preferences.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')))
with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = business_profile_section_preferences.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')));
