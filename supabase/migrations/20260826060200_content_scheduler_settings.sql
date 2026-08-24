-- Per-workspace "Automatic Publishing" switch, replacing Acapolite's
-- single global singleton (social_scheduler_settings, one row ever) with
-- one row per workspace. No per-row timezone column: scheduling reads
-- workspace_settings.timezone directly (see content_series migration).
--
-- Security model, unchanged from Acapolite's proven design: authenticated
-- users may SELECT their workspace's row, but there is NO insert/update
-- policy for authenticated at all. The row can only be mutated through the
-- content-scheduler-settings edge function, which re-verifies
-- has_workspace_role(workspace_id, 'admin') using the caller's own session
-- before writing with the service role key - a plain client-side
-- `.update()` call is structurally impossible, not just discouraged.
--
-- Effective auto-publish = (env kill switch) AND (this row's
-- auto_publish_enabled) - see _shared/contentSchedulerSettings.ts. Auto
-- -publish defaults OFF and this migration never touches the env kill
-- switch (CONTENT_AUTO_PUBLISH_ENABLED, set at the edge function deployment
-- level only).

create table if not exists public.content_scheduler_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  auto_publish_enabled boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.content_scheduler_settings enable row level security;

drop policy if exists "content_scheduler_settings_select" on public.content_scheduler_settings;
create policy "content_scheduler_settings_select"
on public.content_scheduler_settings for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.view'));

-- Backfill: every workspace that already exists (created before this
-- migration) gets a default-off settings row now, same as the
-- create_workspace() bootstrap below gives every NEW workspace.
insert into public.content_scheduler_settings (workspace_id)
select w.id from public.workspaces w
where not exists (select 1 from public.content_scheduler_settings s where s.workspace_id = w.id);

-- Extend the existing bootstrap RPC (originally
-- 20260824060200_workspace_authorization_helpers.sql) so every new
-- workspace gets a content_scheduler_settings row atomically, the same way
-- it already gets workspace_settings/workspace_billing rows - no
-- separate migration needed later just to keep this table populated.
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
  insert into public.content_scheduler_settings (workspace_id) values (v_workspace_id);

  return v_workspace_id;
end;
$$;
