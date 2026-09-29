-- Plans, pricing and entitlements: database-driven commercial model with
-- ONE canonical server-side entitlement evaluator.
--
-- Design decisions:
--  * Catalogue tables (billing_products, billing_plans, billing_prices,
--    entitlement_definitions, plan_entitlements) are readable by any
--    authenticated user (a pricing page is public information) and
--    writable ONLY by the service role - operators edit them through the
--    audited operator edge function, never through client RLS.
--  * A price row is immutable once created (amount/currency/interval):
--    changing a price means creating a new price and deactivating the old
--    one, so a subscription's price_id always describes what the customer
--    actually agreed to pay.
--  * Paid access is granted ONLY by rows the service role writes after
--    verified backend payment state (workspace_subscriptions,
--    workspace_purchases) or by an audited operator override
--    (workspace_entitlement_overrides). A browser redirect cannot reach
--    any of these tables.
--  * workspace_billing.plan / limits pre-date this model. `limits` is
--    still the source for the existing Inbox/Flow AI token caps, which is
--    exactly why it can no longer be owner-editable (an owner could raise
--    their own AI spend cap with a raw PATCH): the existing
--    status/trial_ends_at protection trigger is widened to plan + limits.
--  * The evaluator (get_workspace_entitlements) combines, per key:
--      free plan baseline  ->  live subscription plan  ->  unexpired
--      once-off purchases  ->  operator override (authoritative, can also
--      REVOKE)
--    Booleans OR together; limits take the largest, NULL = unlimited
--    wins. Overrides replace the combined value outright.
-- ---------------------------------------------------------------------------

-- Lock down workspace_billing.plan / limits --------------------------------------

create or replace function public.workspace_billing_protect_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.plan is distinct from old.plan
     or new.limits is distinct from old.limits then
    raise exception 'workspace_billing status, plan and limits can only be changed by the platform' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Platform-operator helper for SQL-side checks (RLS never grants operators
-- a bypass; this is used only inside SECURITY DEFINER evaluators).
create or replace function public.is_platform_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_operator from public.profiles where id = auth.uid()), false);
$$;

revoke execute on function public.is_platform_operator() from public, anon;
grant execute on function public.is_platform_operator() to authenticated, service_role;

-- Catalogue ------------------------------------------------------------------------

create table if not exists public.billing_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 2000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.billing_products(id) on delete restrict,
  code text not null unique check (code ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 2000),
  -- 'subscription' plans are held via workspace_subscriptions;
  -- 'one_off' plans are bought via workspace_purchases.
  plan_kind text not null default 'subscription' check (plan_kind in ('subscription', 'one_off', 'free')),
  tier_rank integer not null default 0,
  is_public boolean not null default true,
  is_active boolean not null default true,
  -- Admin-editable marketing copy (feature bullets, badge, CTA label).
  -- Presentation only - never read by the entitlement evaluator.
  marketing jsonb not null default '{}'::jsonb check (jsonb_typeof(marketing) = 'object'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Exactly one free baseline plan.
create unique index if not exists billing_plans_one_free on public.billing_plans ((plan_kind)) where plan_kind = 'free';

create table if not exists public.billing_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  billing_interval text not null check (billing_interval in ('once', 'month', 'year')),
  -- Once-off purchases may grant access for a fixed number of days;
  -- NULL = permanent.
  access_days integer check (access_days is null or access_days > 0),
  -- Paystack plan code (PLN_...) for recurring prices. Configured by an
  -- operator after creating the plan in Paystack; a recurring price with
  -- no plan code cannot be checked out.
  paystack_plan_code text check (paystack_plan_code is null or paystack_plan_code ~ '^PLN_[A-Za-z0-9]+$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (billing_interval = 'once' or access_days is null)
);
create index if not exists billing_prices_plan_idx on public.billing_prices (plan_id, is_active);

create or replace function public.billing_prices_immutable_terms()
returns trigger
language plpgsql
as $$
begin
  if new.plan_id is distinct from old.plan_id
     or new.currency is distinct from old.currency
     or new.amount_minor is distinct from old.amount_minor
     or new.billing_interval is distinct from old.billing_interval
     or new.access_days is distinct from old.access_days then
    raise exception 'Price terms are immutable - create a new price and deactivate this one' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_prices_immutable_terms_trg on public.billing_prices;
create trigger billing_prices_immutable_terms_trg before update on public.billing_prices
  for each row execute function public.billing_prices_immutable_terms();

create table if not exists public.entitlement_definitions (
  key text primary key check (key ~ '^[a-z0-9_.]{2,80}$'),
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  -- boolean: on/off. limit: a standing cap (e.g. seats). allowance: a cap
  -- that resets every reset_period and is consumed via consume_entitlement.
  kind text not null check (kind in ('boolean', 'limit', 'allowance')),
  unit text check (unit is null or length(unit) <= 40),
  reset_period text not null default 'none' check (reset_period in ('none', 'month')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'allowance') = (reset_period <> 'none'))
);

create table if not exists public.plan_entitlements (
  plan_id uuid not null references public.billing_plans(id) on delete cascade,
  entitlement_key text not null references public.entitlement_definitions(key) on delete cascade,
  bool_value boolean,
  -- NULL limit on a limit/allowance entitlement = unlimited.
  limit_value bigint check (limit_value is null or limit_value >= 0),
  primary key (plan_id, entitlement_key)
);

-- Workspace holdings (service-role written) --------------------------------------

create table if not exists public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  price_id uuid references public.billing_prices(id) on delete restrict,
  -- incomplete: checkout started, not yet paid (grants nothing)
  -- active: paid and current
  -- past_due: a renewal charge failed; still inside the paid period
  -- grace: period ended unpaid; access retained until grace_until
  -- cancelled: customer/operator cancelled; access until current_period_end
  -- expired: no access
  status text not null default 'incomplete' check (status in ('incomplete', 'active', 'past_due', 'grace', 'cancelled', 'expired')),
  provider text not null default 'paystack' check (provider in ('paystack', 'operator')),
  provider_customer_code text,
  provider_subscription_code text,
  provider_email_token text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workspace_subscriptions_workspace_idx on public.workspace_subscriptions (workspace_id, created_at desc);
create unique index if not exists workspace_subscriptions_provider_code_key
  on public.workspace_subscriptions (provider_subscription_code) where provider_subscription_code is not null;
-- At most one live (billing) subscription per workspace. 'cancelled' is
-- excluded: a cancelled subscription still grants access until its period
-- ends, and the customer may re-subscribe during that window.
create unique index if not exists workspace_subscriptions_one_live
  on public.workspace_subscriptions (workspace_id) where status in ('active', 'past_due', 'grace');

create table if not exists public.workspace_purchases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  price_id uuid not null references public.billing_prices(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded', 'abandoned')),
  provider text not null default 'paystack' check (provider in ('paystack', 'operator')),
  provider_reference text unique,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'ZAR',
  paid_at timestamptz,
  access_expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workspace_purchases_workspace_idx on public.workspace_purchases (workspace_id, created_at desc);

create table if not exists public.workspace_entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entitlement_key text not null references public.entitlement_definitions(key) on delete cascade,
  bool_value boolean,
  limit_value bigint check (limit_value is null or limit_value >= 0),
  reason text not null check (length(trim(reason)) between 1 and 500),
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, entitlement_key)
);

create table if not exists public.entitlement_usage (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entitlement_key text not null references public.entitlement_definitions(key) on delete cascade,
  period_start date not null,
  used bigint not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entitlement_key, period_start)
);

do $$
declare
  t text;
begin
  foreach t in array array['billing_products', 'billing_plans', 'billing_prices', 'entitlement_definitions',
                           'workspace_subscriptions', 'workspace_purchases']
  loop
    execute format('drop trigger if exists set_%1$s_updated_at on public.%1$I', t);
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end
$$;

-- RLS -------------------------------------------------------------------------------
-- Catalogue: read-all for signed-in users; no client write policy at all.
-- Holdings: members read their own workspace; no client write policy.

do $$
declare
  t text;
begin
  foreach t in array array['billing_products', 'billing_plans', 'billing_prices', 'entitlement_definitions', 'plan_entitlements']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%1$s_read_all" on public.%1$I', t);
    execute format('create policy "%1$s_read_all" on public.%1$I for select to authenticated using (true)', t);
  end loop;

  foreach t in array array['workspace_subscriptions', 'workspace_purchases', 'workspace_entitlement_overrides', 'entitlement_usage']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%1$s_select_member" on public.%1$I', t);
    execute format('create policy "%1$s_select_member" on public.%1$I for select to authenticated using (public.is_workspace_member(workspace_id))', t);
  end loop;
end
$$;

-- Public (logged-out) pricing page needs the active public catalogue.
drop policy if exists "billing_plans_read_public_anon" on public.billing_plans;
create policy "billing_plans_read_public_anon" on public.billing_plans for select to anon using (is_public and is_active);
drop policy if exists "billing_prices_read_public_anon" on public.billing_prices;
create policy "billing_prices_read_public_anon" on public.billing_prices for select to anon
  using (is_active and exists (select 1 from public.billing_plans p where p.id = plan_id and p.is_public and p.is_active));
drop policy if exists "plan_entitlements_read_public_anon" on public.plan_entitlements;
create policy "plan_entitlements_read_public_anon" on public.plan_entitlements for select to anon
  using (exists (select 1 from public.billing_plans p where p.id = plan_id and p.is_public and p.is_active));
drop policy if exists "entitlement_definitions_read_anon" on public.entitlement_definitions;
create policy "entitlement_definitions_read_anon" on public.entitlement_definitions for select to anon using (true);

-- Canonical evaluator ------------------------------------------------------------

-- The evaluator is split into UNCHECKED internal functions (_-prefixed,
-- executable only by the function owner / service role) and the public,
-- authorised wrappers. Internal callers that have their own authorisation
-- story (e.g. the anonymous hosted-profile read) use the _ versions.

create or replace function public.assert_workspace_billing_reader(p_workspace_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     and not public.is_workspace_member(p_workspace_id)
     and not public.is_platform_operator() then
    raise exception 'Not authorized for this workspace' using errcode = '42501';
  end if;
end;
$$;

-- Which plans currently grant access to a workspace, with where each came
-- from.
create or replace function public._workspace_access_plans(p_workspace_id uuid)
returns table (plan_id uuid, plan_code text, tier_rank integer, source text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.code, p.tier_rank, 'free'::text
  from public.billing_plans p
  where p.plan_kind = 'free' and p.is_active
  union all
  select p.id, p.code, p.tier_rank, 'subscription'::text
  from public.workspace_subscriptions s
  join public.billing_plans p on p.id = s.plan_id
  where s.workspace_id = p_workspace_id
    and (
      (s.status in ('active', 'past_due') and (s.current_period_end is null or s.current_period_end > now() - interval '1 day'))
      or (s.status = 'grace' and s.grace_until > now())
      or (s.status = 'cancelled' and s.current_period_end > now())
    )
  union all
  select p.id, p.code, p.tier_rank, 'purchase'::text
  from public.workspace_purchases wp
  join public.billing_plans p on p.id = wp.plan_id
  where wp.workspace_id = p_workspace_id
    and wp.status = 'paid'
    and (wp.access_expires_at is null or wp.access_expires_at > now());
$$;

create or replace function public.workspace_access_plans(p_workspace_id uuid)
returns table (plan_id uuid, plan_code text, tier_rank integer, source text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_workspace_billing_reader(p_workspace_id);
  return query select * from public._workspace_access_plans(p_workspace_id);
end;
$$;

create or replace function public._workspace_entitlements(p_workspace_id uuid)
returns table (
  entitlement_key text,
  kind text,
  enabled boolean,
  limit_value bigint,
  unlimited boolean,
  used bigint,
  source text
)
language sql
stable
security definer
set search_path = public
as $$
  with plans as (
    select * from public._workspace_access_plans(p_workspace_id)
  ),
  granted as (
    select
      pe.entitlement_key as k,
      bool_or(coalesce(pe.bool_value, false)) as b,
      bool_or(pe.limit_value is null and pe.bool_value is distinct from false) as unl,
      max(pe.limit_value) as lim,
      string_agg(distinct pl.source, ',') as src
    from plans pl
    join public.plan_entitlements pe on pe.plan_id = pl.plan_id
    group by pe.entitlement_key
  ),
  ov as (
    select o.entitlement_key as k, o.bool_value, o.limit_value
    from public.workspace_entitlement_overrides o
    where o.workspace_id = p_workspace_id and (o.expires_at is null or o.expires_at > now())
  ),
  usage as (
    select u.entitlement_key as k, u.used
    from public.entitlement_usage u
    where u.workspace_id = p_workspace_id
      and u.period_start = date_trunc('month', now())::date
  )
  select
    d.key,
    d.kind,
    case
      when ov.k is not null then
        case when d.kind = 'boolean' then coalesce(ov.bool_value, false) else coalesce(ov.bool_value, true) and (ov.limit_value is null or ov.limit_value > 0) end
      when g.k is null then false
      when d.kind = 'boolean' then g.b
      else (g.unl or coalesce(g.lim, 0) > 0)
    end,
    case
      when d.kind = 'boolean' then null
      when ov.k is not null then ov.limit_value
      when g.unl then null
      else coalesce(g.lim, 0)
    end,
    case
      when d.kind = 'boolean' then false
      when ov.k is not null then ov.limit_value is null and coalesce(ov.bool_value, true)
      else coalesce(g.unl, false)
    end,
    coalesce(us.used, 0),
    case when ov.k is not null then 'override' else coalesce(g.src, 'none') end
  from public.entitlement_definitions d
  left join granted g on g.k = d.key
  left join ov on ov.k = d.key
  left join usage us on us.k = d.key
  order by d.sort_order, d.key;
$$;

create or replace function public.get_workspace_entitlements(p_workspace_id uuid)
returns table (
  entitlement_key text,
  kind text,
  enabled boolean,
  limit_value bigint,
  unlimited boolean,
  used bigint,
  source text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_workspace_billing_reader(p_workspace_id);
  return query select * from public._workspace_entitlements(p_workspace_id);
end;
$$;

create or replace function public.workspace_has_entitlement(p_workspace_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select enabled from public.get_workspace_entitlements(p_workspace_id) where entitlement_key = p_key), false);
$$;

-- Highest-tier plan currently held (used by feature-flag plan targeting).
create or replace function public.workspace_plan_codes(p_workspace_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct plan_code), '{}') from public.workspace_access_plans(p_workspace_id);
$$;

-- Atomically consume an allowance/limit. Service-role only: every consumer
-- is a backend function that has already authorized the caller. Returns
-- false (and consumes nothing) when the allowance would be exceeded.
create or replace function public.consume_entitlement(p_workspace_id uuid, p_key text, p_amount bigint default 1)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ent record;
  v_period date := date_trunc('month', now())::date;
  v_used bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'p_amount must be positive' using errcode = '22023';
  end if;

  select * into v_ent from public.get_workspace_entitlements(p_workspace_id) where entitlement_key = p_key;
  if v_ent is null or not v_ent.enabled then
    return false;
  end if;
  if v_ent.kind = 'boolean' then
    return true;
  end if;

  insert into public.entitlement_usage (workspace_id, entitlement_key, period_start, used)
  values (p_workspace_id, p_key, v_period, 0)
  on conflict do nothing;

  select used into v_used from public.entitlement_usage
  where workspace_id = p_workspace_id and entitlement_key = p_key and period_start = v_period
  for update;

  if not v_ent.unlimited and v_used + p_amount > v_ent.limit_value then
    return false;
  end if;

  update public.entitlement_usage
  set used = used + p_amount, updated_at = now()
  where workspace_id = p_workspace_id and entitlement_key = p_key and period_start = v_period;
  return true;
end;
$$;

revoke execute on function public._workspace_access_plans(uuid) from public, anon, authenticated;
revoke execute on function public._workspace_entitlements(uuid) from public, anon, authenticated;
revoke execute on function public.assert_workspace_billing_reader(uuid) from public, anon;
grant execute on function public._workspace_access_plans(uuid) to service_role;
grant execute on function public._workspace_entitlements(uuid) to service_role;
grant execute on function public.assert_workspace_billing_reader(uuid) to authenticated, service_role;
revoke execute on function public.workspace_access_plans(uuid) from public, anon;
revoke execute on function public.get_workspace_entitlements(uuid) from public, anon;
revoke execute on function public.workspace_has_entitlement(uuid, text) from public, anon;
revoke execute on function public.workspace_plan_codes(uuid) from public, anon;
revoke execute on function public.consume_entitlement(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.workspace_access_plans(uuid) to authenticated, service_role;
grant execute on function public.get_workspace_entitlements(uuid) to authenticated, service_role;
grant execute on function public.workspace_has_entitlement(uuid, text) to authenticated, service_role;
grant execute on function public.workspace_plan_codes(uuid) to authenticated, service_role;
grant execute on function public.consume_entitlement(uuid, text, bigint) to service_role;

-- Seed catalogue (all editable from Admin afterwards) ------------------------------
-- Prices are the indicative launch values and MUST be confirmed by the
-- platform owner in Admin -> Pricing before launch.

insert into public.billing_products (code, name, description) values
  ('business_studio', 'Business Studio', 'Turn your website into a professional company profile.')
on conflict (code) do nothing;

insert into public.entitlement_definitions (key, name, description, kind, unit, reset_period, sort_order) values
  ('business_studio.access', 'Business Studio', 'Use Business Studio to build a company profile.', 'boolean', null, 'none', 10),
  ('business_profile.pdf_export', 'Professional PDF', 'Download the finished A4 company profile PDF (no watermark).', 'boolean', null, 'none', 20),
  ('business_profile.premium_designs', 'Premium designs', 'Access to premium profile designs.', 'boolean', null, 'none', 30),
  ('business_profile.documents', 'Saved documents', 'Number of saved profile documents.', 'limit', 'documents', 'none', 40),
  ('hosted_profile.publish', 'Hosted business profile', 'Publish a hosted StabiFlow business profile page.', 'boolean', null, 'none', 50),
  ('website_monitoring', 'Website monitoring', 'Periodically recheck your website for changes.', 'boolean', null, 'none', 60),
  ('website_scans', 'Website scans', 'Website scans per month.', 'allowance', 'scans', 'month', 70),
  ('ai_credits', 'AI writing credits', 'AI wording improvements per month.', 'allowance', 'credits', 'month', 80),
  ('team_seats', 'Team members', 'Number of workspace members.', 'limit', 'seats', 'none', 90)
on conflict (key) do nothing;

insert into public.billing_plans (product_id, code, name, description, plan_kind, tier_rank, is_public, is_active, sort_order, marketing)
select pr.id, v.code, v.name, v.description, v.plan_kind, v.tier_rank, v.is_public, v.is_active, v.sort_order, v.marketing::jsonb
from public.billing_products pr
cross join (values
  ('free', 'Free', 'Try Business Studio and build your first profile draft.', 'free', 0, true, true, 10,
    '{"features": ["Scan your website", "Review and correct your business facts", "Preview your profile"], "cta": "Start free"}'),
  ('profile_once', 'Professional Profile', 'A once-off professional A4 company profile PDF.', 'one_off', 10, true, true, 20,
    '{"features": ["Professional A4 PDF", "No watermark", "Premium designs"], "cta": "Buy once"}'),
  ('business', 'Business', 'Keep your company profile current and hosted.', 'subscription', 20, true, true, 30,
    '{"features": ["Everything in Professional Profile", "Hosted business profile", "Website monitoring", "More AI credits"], "cta": "Choose Business", "badge": "Most popular"}'),
  ('growth', 'Growth', 'For growing businesses with more documents and team members.', 'subscription', 30, true, true, 40,
    '{"features": ["Everything in Business", "More documents and scans", "More team members"], "cta": "Choose Growth"}'),
  ('pro', 'Pro', 'Advanced StabiFlow modules (coming later).', 'subscription', 40, false, false, 50, '{}')
) as v(code, name, description, plan_kind, tier_rank, is_public, is_active, sort_order, marketing)
where pr.code = 'business_studio'
on conflict (code) do nothing;

-- Indicative prices in ZAR cents.
insert into public.billing_prices (plan_id, currency, amount_minor, billing_interval, access_days)
select p.id, 'ZAR', v.amount, v.intv, v.days
from public.billing_plans p
join (values
  ('profile_once', 29900::bigint, 'once', null::integer),
  ('business', 24900, 'month', null),
  ('business', 249000, 'year', null),
  ('growth', 59900, 'month', null),
  ('growth', 599000, 'year', null)
) as v(code, amount, intv, days) on v.code = p.code
where not exists (select 1 from public.billing_prices bp where bp.plan_id = p.id);

insert into public.plan_entitlements (plan_id, entitlement_key, bool_value, limit_value)
select p.id, v.k, v.b, v.l
from public.billing_plans p
join (values
  ('free', 'business_studio.access', true, null::bigint),
  ('free', 'business_profile.documents', null, 1),
  ('free', 'website_scans', null, 2),
  ('free', 'ai_credits', null, 10),
  ('free', 'team_seats', null, 1),
  ('profile_once', 'business_profile.pdf_export', true, null),
  ('profile_once', 'business_profile.premium_designs', true, null),
  ('profile_once', 'business_profile.documents', null, 2),
  ('profile_once', 'ai_credits', null, 30),
  ('business', 'business_studio.access', true, null),
  ('business', 'business_profile.pdf_export', true, null),
  ('business', 'business_profile.premium_designs', true, null),
  ('business', 'business_profile.documents', null, 10),
  ('business', 'hosted_profile.publish', true, null),
  ('business', 'website_monitoring', true, null),
  ('business', 'website_scans', null, 10),
  ('business', 'ai_credits', null, 100),
  ('business', 'team_seats', null, 3),
  ('growth', 'business_studio.access', true, null),
  ('growth', 'business_profile.pdf_export', true, null),
  ('growth', 'business_profile.premium_designs', true, null),
  ('growth', 'business_profile.documents', null, 50),
  ('growth', 'hosted_profile.publish', true, null),
  ('growth', 'website_monitoring', true, null),
  ('growth', 'website_scans', null, 40),
  ('growth', 'ai_credits', null, 500),
  ('growth', 'team_seats', null, 10)
) as v(code, k, b, l) on v.code = p.code
on conflict (plan_id, entitlement_key) do nothing;
