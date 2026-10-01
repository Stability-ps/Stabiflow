-- Per-user, per-workspace Home dashboard layout: which widgets are shown
-- and in what order. No existing preference table covers this - see
-- survey notes on workspace_settings (workspace-level only, no per-user
-- row anywhere in the schema).
--
-- Different staff members in the same workspace choose different
-- dashboards (an owner wants revenue, a sales rep wants leads), so this is
-- scoped to (workspace_id, user_id), not to the workspace alone.
create table if not exists public.dashboard_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Ordered array of {"id": "<widget id>", "visible": true|false}. The
  -- client is the source of truth for which widget ids are valid (the
  -- registry, src/lib/dashboard/widgetRegistry.ts) - this column only
  -- stores layout, never widget data, so an old/removed id here is
  -- harmless (the client simply skips ids it doesn't recognise).
  widgets jsonb not null default '[]'::jsonb,
  -- The last preset applied ("business_owner" | "sales" | "marketing"),
  -- or null once the user has customised past a preset. Display-only
  -- (e.g. "based on the Sales preset") - never re-applied automatically.
  preset text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists dashboard_preferences_workspace_idx on public.dashboard_preferences (workspace_id);

drop trigger if exists set_dashboard_preferences_updated_at on public.dashboard_preferences;
create trigger set_dashboard_preferences_updated_at before update on public.dashboard_preferences
  for each row execute function public.set_updated_at();

alter table public.dashboard_preferences enable row level security;

-- A user may only ever read/write their OWN row, and only while they
-- remain a member of that workspace - never another member's layout, and
-- never a workspace they've left.
create policy "Users manage their own dashboard preferences"
  on public.dashboard_preferences
  for all
  to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id))
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));

comment on table public.dashboard_preferences is
  'Per-user, per-workspace Home dashboard widget layout (visibility + order). Never shared across users; RLS restricts each row to its own user_id.';
