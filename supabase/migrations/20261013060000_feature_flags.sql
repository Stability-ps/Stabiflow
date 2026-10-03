-- Functional feature flags.
--
-- workspace_settings.feature_flags (jsonb, since 20260824060100) was never
-- read by anything and stays untouched. Flags now live in a platform-level
-- table evaluated by ONE server-side function.
--
-- Evaluation (evaluate_feature_flags), per flag, first match wins:
--   1. is_enabled = false                -> OFF for everyone (kill switch)
--   2. caller is a platform operator     -> ON (controlled super-admin access)
--   3. explicit workspace target row     -> that row's enabled value
--   4. audience = 'everyone'             -> ON
--   5. audience = 'operators'            -> OFF (admin-only)
--   6. audience = 'targeted'             -> ON if the workspace holds one of
--      plan_codes, OR falls inside rollout_percentage (stable hash of
--      flag key + workspace id, so a workspace does not flicker in and out
--      as the percentage is raised)
--
-- Launch posture: advanced StabiFlow modules are seeded as 'targeted' to
-- the (not yet sold) 'pro' plan at 0% rollout, so NEW workspaces see only
-- Business Studio. Every workspace that exists when this migration runs
-- is grandfathered with explicit workspace targets, so nobody loses a
-- module they already use. Nothing is deleted; flags only hide UI.
-- ---------------------------------------------------------------------------

create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z0-9_.]{2,80}$'),
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  category text not null default 'module' check (category in ('module', 'feature', 'experiment', 'operational')),
  is_enabled boolean not null default true,
  audience text not null default 'targeted' check (audience in ('everyone', 'operators', 'targeted')),
  plan_codes text[] not null default '{}',
  rollout_percentage integer not null default 0 check (rollout_percentage between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_feature_flags_updated_at on public.feature_flags;
create trigger set_feature_flags_updated_at before update on public.feature_flags
  for each row execute function public.set_updated_at();

create table if not exists public.feature_flag_workspace_targets (
  flag_key text not null references public.feature_flags(key) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  enabled boolean not null,
  reason text not null check (length(trim(reason)) between 1 and 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (flag_key, workspace_id)
);
create index if not exists feature_flag_workspace_targets_ws_idx on public.feature_flag_workspace_targets (workspace_id);

-- Flag definitions are not secret, but targeting rows reveal which other
-- workspaces are in a rollout - no client read. Both are service-role
-- written (operator edge function).
alter table public.feature_flags enable row level security;
alter table public.feature_flag_workspace_targets enable row level security;

create or replace function public.feature_flag_bucket(p_flag_key text, p_workspace_id uuid)
returns integer
language sql
immutable
as $$
  -- 0..99, stable per (flag, workspace).
  select (('x' || substr(md5(p_flag_key || ':' || p_workspace_id::text), 1, 8))::bit(32)::bigint % 100)::integer;
$$;

create or replace function public.evaluate_feature_flags(p_workspace_id uuid)
returns table (flag_key text, enabled boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_operator boolean := public.is_platform_operator();
  v_plans text[];
begin
  if auth.role() is distinct from 'service_role'
     and not v_is_operator
     and not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not authorized for this workspace' using errcode = '42501';
  end if;

  v_plans := public.workspace_plan_codes(p_workspace_id);

  return query
  select
    f.key,
    case
      when not f.is_enabled then false
      when v_is_operator then true
      when t.flag_key is not null then t.enabled
      when f.audience = 'everyone' then true
      when f.audience = 'operators' then false
      else (f.plan_codes && v_plans) or public.feature_flag_bucket(f.key, p_workspace_id) < f.rollout_percentage
    end,
    case
      when not f.is_enabled then 'disabled'
      when v_is_operator then 'operator'
      when t.flag_key is not null then 'workspace_target'
      when f.audience = 'everyone' then 'everyone'
      when f.audience = 'operators' then 'operators_only'
      when f.plan_codes && v_plans then 'plan'
      when public.feature_flag_bucket(f.key, p_workspace_id) < f.rollout_percentage then 'rollout'
      else 'not_targeted'
    end
  from public.feature_flags f
  left join public.feature_flag_workspace_targets t on t.flag_key = f.key and t.workspace_id = p_workspace_id
  order by f.key;
end;
$$;

create or replace function public.is_feature_enabled(p_workspace_id uuid, p_flag_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select enabled from public.evaluate_feature_flags(p_workspace_id) where flag_key = p_flag_key), false);
$$;

revoke execute on function public.evaluate_feature_flags(uuid) from public, anon;
revoke execute on function public.is_feature_enabled(uuid, text) from public, anon;
grant execute on function public.evaluate_feature_flags(uuid) to authenticated, service_role;
grant execute on function public.is_feature_enabled(uuid, text) to authenticated, service_role;

-- Seed ----------------------------------------------------------------------------

insert into public.feature_flags (key, name, description, category, is_enabled, audience, plan_codes, rollout_percentage) values
  ('module.business_studio', 'Business Studio', 'Website to company profile.', 'module', true, 'everyone', '{}', 0),
  ('module.content', 'Content', 'Content calendar, scheduling and media library.', 'module', true, 'targeted', '{pro}', 0),
  ('module.campaigns', 'Campaigns', 'Meta ad campaigns.', 'module', true, 'targeted', '{pro}', 0),
  ('module.creative_studio', 'Creative Studio', 'AI ad creative generation.', 'module', true, 'targeted', '{pro}', 0),
  ('module.whatsapp', 'WhatsApp', 'WhatsApp inbox, contacts, templates and intake.', 'module', true, 'targeted', '{pro}', 0),
  ('module.leads', 'Leads', 'Leads and pipelines.', 'module', true, 'targeted', '{pro}', 0),
  ('module.customers', 'Customers', 'Customer 360.', 'module', true, 'targeted', '{pro}', 0),
  ('module.analytics', 'Analytics', 'Revenue, attribution and campaign analytics.', 'module', true, 'targeted', '{pro}', 0),
  ('module.flow_ai', 'Flow AI', 'Flow AI assistant.', 'module', true, 'targeted', '{pro}', 0),
  ('module.automations', 'Automations', 'Automation engine.', 'module', true, 'targeted', '{pro}', 0),
  ('module.integrations', 'Integrations', 'Meta/WhatsApp integrations.', 'module', true, 'targeted', '{pro}', 0)
on conflict (key) do nothing;

-- Grandfather every existing workspace into every advanced module.
insert into public.feature_flag_workspace_targets (flag_key, workspace_id, enabled, reason)
select f.key, w.id, true, 'Grandfathered: workspace existed before the Business Studio launch'
from public.feature_flags f
cross join public.workspaces w
where f.key like 'module.%' and f.key <> 'module.business_studio'
on conflict (flag_key, workspace_id) do nothing;

comment on table public.feature_flags is
  'Platform feature flags. Evaluate ONLY via evaluate_feature_flags / is_feature_enabled. workspace_settings.feature_flags jsonb is legacy and unused.';
