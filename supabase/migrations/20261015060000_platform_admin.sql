-- Platform admin: audit trail for platform-level configuration changes
-- (plans, prices, entitlements, flags, settings, overrides) and seed keys
-- for admin-editable public copy.
--
-- platform_operator_actions (20260914060000) requires a workspace and stays
-- the log for workspace-targeted actions (suspend/unsuspend). Platform-
-- level changes have no single workspace, so they get their own table with
-- before/after snapshots. Service-role only - read and written exclusively
-- by the operator-admin edge function after it has verified
-- profiles.is_platform_operator server-side.

create table if not exists public.platform_admin_audit (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (length(action) between 1 and 80),
  target_type text not null check (length(target_type) between 1 and 60),
  target_id text,
  workspace_id uuid references public.workspaces(id) on delete set null,
  reason text check (reason is null or length(reason) <= 500),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_admin_audit_created_idx on public.platform_admin_audit (created_at desc);
create index if not exists platform_admin_audit_target_idx on public.platform_admin_audit (target_type, target_id, created_at desc);

alter table public.platform_admin_audit enable row level security;
-- No client policies: service role only.

-- Admin-editable public copy. Values are plain text / structured JSON
-- rendered as TEXT by the frontend (never as HTML).
insert into public.platform_settings (key, value, description, is_public) values
  ('content.home_hero', '{"title": "Turn your website into a professional company profile", "subtitle": "Give StabiFlow your website. Verify what we find. Get a professional company profile."}'::jsonb, 'Public home page headline and subtitle.', true),
  ('content.pricing_intro', '{"text": "Start free. Pay once for a professional profile, or subscribe to keep it current and hosted."}'::jsonb, 'Intro copy above the pricing plans.', true),
  ('content.faq', '[]'::jsonb, 'Public FAQ entries: [{"question": "...", "answer": "..."}].', true)
on conflict (key) do nothing;
