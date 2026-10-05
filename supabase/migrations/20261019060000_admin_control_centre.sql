-- Admin Control Centre foundation.
--
-- 1. platform_admin_roles: explicit staff roles (owner, admin, support,
--    finance, analyst, marketing). The role -> permission matrix lives in
--    supabase/functions/_shared/admin/permissions.ts and is enforced by the
--    admin edge functions with the service-role client. No client policies.
-- 2. profiles.is_platform_operator stays as the legacy SQL-side gate (used by
--    billing/flag read helpers). It is now DERIVED: true only for owner/admin
--    roles, kept in sync by trigger. Narrower roles never get it.
-- 3. platform_admin_audit becomes append-only.
-- 4. Read models for the admin console. All aggregation happens here so the
--    browser never receives raw tables. EXECUTE is service_role only; the
--    admin-console edge function authorizes the caller first.

-- 1. Roles ---------------------------------------------------------------------------

create table if not exists public.platform_admin_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'support', 'finance', 'analyst', 'marketing')),
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_admin_roles enable row level security;
-- No client policies: service role only.

-- Existing operators become owners.
insert into public.platform_admin_roles (user_id, role)
select id, 'owner' from public.profiles where is_platform_operator
on conflict (user_id) do nothing;

-- Never leave the platform without an owner.
create or replace function public.platform_admin_roles_keep_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role is distinct from 'owner')
     and not exists (select 1 from public.platform_admin_roles where role = 'owner' and user_id <> old.user_id) then
    raise exception 'The last owner cannot be removed or demoted' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists platform_admin_roles_keep_owner_trg on public.platform_admin_roles;
create trigger platform_admin_roles_keep_owner_trg
  before update or delete on public.platform_admin_roles
  for each row execute function public.platform_admin_roles_keep_owner();

create or replace function public.platform_admin_roles_sync_operator_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.profiles set is_platform_operator = false where id = old.user_id and is_platform_operator;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.profiles set is_platform_operator = (new.role in ('owner', 'admin')) where id = new.user_id;
  end if;
  return null;
end;
$$;

drop trigger if exists platform_admin_roles_sync_trg on public.platform_admin_roles;
create trigger platform_admin_roles_sync_trg
  after insert or update or delete on public.platform_admin_roles
  for each row execute function public.platform_admin_roles_sync_operator_flag();

-- The protect trigger (20260916060000) only lets service_role flip the flag.
-- Also allow it when the change comes from the role-sync trigger above
-- (pg_trigger_depth() > 1): that is the only trigger that writes this
-- column, and the roles table itself has no client write path.
create or replace function public.profiles_protect_platform_operator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.is_platform_operator is distinct from old.is_platform_operator then
    raise exception 'profiles.is_platform_operator can only be changed by a platform operator' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- The signed-in user's own admin role (null for customers). UX only - every
-- admin endpoint re-checks the role server-side.
create or replace function public.my_admin_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.platform_admin_roles where user_id = auth.uid();
$$;
revoke execute on function public.my_admin_role() from public, anon;
grant execute on function public.my_admin_role() to authenticated, service_role;

-- 2. Append-only audit ---------------------------------------------------------------

create index if not exists platform_admin_audit_operator_idx on public.platform_admin_audit (operator_user_id, created_at desc);
create index if not exists platform_admin_audit_workspace_idx on public.platform_admin_audit (workspace_id, created_at desc) where workspace_id is not null;

create or replace function public.platform_admin_audit_append_only()
returns trigger
language plpgsql
as $$
begin
  -- The only permitted change: workspace_id cleared by its FK when a
  -- workspace is deleted.
  if tg_op = 'UPDATE'
     and old.workspace_id is not null and new.workspace_id is null
     and (to_jsonb(new) - 'workspace_id') = (to_jsonb(old) - 'workspace_id') then
    return new;
  end if;
  raise exception 'platform_admin_audit is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists platform_admin_audit_append_only_trg on public.platform_admin_audit;
create trigger platform_admin_audit_append_only_trg
  before update or delete on public.platform_admin_audit
  for each row execute function public.platform_admin_audit_append_only();

-- 3. Indexes for admin date-range queries -------------------------------------------

create index if not exists billing_transactions_created_idx on public.billing_transactions (created_at desc);
create index if not exists billing_transactions_paid_idx on public.billing_transactions (paid_at desc) where status = 'success';
create index if not exists billing_webhook_events_received_idx on public.billing_webhook_events (received_at desc);
create index if not exists ai_usage_events_created_idx on public.ai_usage_events (created_at desc);
create index if not exists automation_runs_status_created_idx on public.automation_runs (status, created_at desc);
create index if not exists workspace_activity_log_created_idx on public.workspace_activity_log (created_at desc);
create index if not exists workspaces_created_idx on public.workspaces (created_at desc);

-- 4. Read models ---------------------------------------------------------------------

-- Escape LIKE wildcards in operator-typed search text.
create or replace function public._admin_like(p_q text)
returns text
language sql
immutable
as $$
  select '%' || replace(replace(replace(coalesce(trim(p_q), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

-- A workspace "pays" when it has a live subscription or an unexpired paid
-- one-off purchase.
create or replace function public._admin_workspace_is_paying(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.workspace_subscriptions s where s.workspace_id = p_workspace_id and s.status in ('active', 'past_due', 'grace'))
      or exists (select 1 from public.workspace_purchases p where p.workspace_id = p_workspace_id and p.status = 'paid' and (p.access_expires_at is null or p.access_expires_at > now()));
$$;

create or replace function public.admin_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days int := least(greatest(ceil(extract(epoch from (p_to - p_from)) / 86400)::int, 1), 400);
  v_result jsonb;
begin
  if p_to <= p_from then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;

  with
  users as (
    select
      count(*) as total,
      count(*) filter (where u.created_at >= p_from and u.created_at < p_to) as new_in_range,
      count(*) filter (where u.created_at >= date_trunc('day', now())) as new_today,
      count(*) filter (where u.created_at >= now() - interval '7 days') as new_7d,
      count(*) filter (where u.created_at >= now() - interval '30 days') as new_30d,
      count(*) filter (where u.last_sign_in_at >= now() - interval '1 day') as signed_in_1d,
      count(*) filter (where u.last_sign_in_at >= now() - interval '7 days') as signed_in_7d,
      count(*) filter (where u.last_sign_in_at >= now() - interval '30 days') as signed_in_30d,
      count(*) filter (where u.email_confirmed_at is null) as unconfirmed,
      count(*) filter (where not exists (select 1 from public.workspace_members m where m.user_id = u.id)) as without_workspace
    from auth.users u
  ),
  active_ws as (
    select distinct workspace_id from public.workspace_activity_log where created_at >= p_from and created_at < p_to
    union select distinct workspace_id from public.ai_usage_events where created_at >= p_from and created_at < p_to and workspace_id is not null
    union select distinct workspace_id from public.inbox_messages where created_at >= p_from and created_at < p_to and direction = 'outbound'
    union select distinct workspace_id from public.leads where created_at >= p_from and created_at < p_to
  ),
  workspaces as (
    select
      count(*) as total,
      count(*) filter (where w.created_at >= p_from and w.created_at < p_to) as new_in_range,
      (select count(*) from active_ws) as active_in_range,
      count(*) filter (where public._admin_workspace_is_paying(w.id)) as paying,
      count(*) filter (where wb.status = 'suspended') as suspended
    from public.workspaces w
    left join public.workspace_billing wb on wb.workspace_id = w.id
  ),
  product as (
    select
      (select count(*) from public.leads where created_at >= p_from and created_at < p_to) as leads_created,
      (select count(*) from public.customers where created_at >= p_from and created_at < p_to) as customers_created,
      (select count(*) from public.opportunities where created_at >= p_from and created_at < p_to) as opportunities_created,
      (select count(*) from public.opportunities where won_at >= p_from and won_at < p_to) as opportunities_won,
      (select count(*) from public.automations where status = 'active') as automations_active,
      (select count(*) from public.automation_runs where created_at >= p_from and created_at < p_to) as automation_runs,
      (select count(*) from public.automation_runs where created_at >= p_from and created_at < p_to and status = 'succeeded') as automation_runs_succeeded,
      (select count(*) from public.automation_runs where created_at >= p_from and created_at < p_to and status = 'failed') as automation_runs_failed,
      (select count(*) from public.content_scheduled_posts where published_at >= p_from and published_at < p_to) as posts_published,
      (select count(*) from public.content_scheduled_posts where status = 'failed' and updated_at >= p_from and updated_at < p_to) as posts_failed,
      (select count(*) from public.creative_studio_concepts where created_at >= p_from and created_at < p_to) as creative_concepts,
      (select count(*) from public.creative_studio_concepts where visual_status = 'failed' and updated_at >= p_from and updated_at < p_to) as creative_failed,
      (select count(*) from public.website_scans where created_at >= p_from and created_at < p_to) as website_scans,
      (select count(*) from public.website_scans where status = 'failed' and created_at >= p_from and created_at < p_to) as website_scans_failed,
      (select count(*) from public.inbox_messages where created_at >= p_from and created_at < p_to and direction = 'inbound') as messages_in,
      (select count(*) from public.inbox_messages where created_at >= p_from and created_at < p_to and direction = 'outbound') as messages_out,
      (select count(*) from public.inbox_messages where dead_lettered_at >= p_from and dead_lettered_at < p_to) as messages_dead_lettered,
      (select count(*) from public.ad_campaigns where created_at >= p_from and created_at < p_to) as campaigns_created,
      (select count(*) from public.hosted_profiles where is_published) as profiles_published
  ),
  ai as (
    select
      count(*) as calls,
      count(*) filter (where status = 'success') as succeeded,
      count(*) filter (where status = 'error') as failed,
      coalesce(sum(total_tokens), 0) as tokens,
      coalesce(sum(estimated_cost), 0) as cost_usd,
      count(*) filter (where estimated_cost is null) as calls_without_cost
    from public.ai_usage_events where created_at >= p_from and created_at < p_to
  ),
  revenue as (
    select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'gross_minor', gross, 'transactions', n) order by currency), '[]'::jsonb) as by_currency
    from (
      select coalesce(paid_currency, currency) as currency, sum(coalesce(paid_amount_minor, amount_minor)) as gross, count(*) as n
      from public.billing_transactions where status = 'success' and paid_at >= p_from and paid_at < p_to
      group by 1
    ) r
  ),
  mrr as (
    select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'mrr_minor', mrr, 'at_risk_minor', at_risk, 'subscriptions', n) order by currency), '[]'::jsonb) as by_currency
    from (
      select p.currency,
        round(sum(case when s.status = 'active' then case p.billing_interval when 'year' then p.amount_minor / 12.0 when 'month' then p.amount_minor else 0 end else 0 end)) as mrr,
        round(sum(case when s.status in ('past_due', 'grace') then case p.billing_interval when 'year' then p.amount_minor / 12.0 when 'month' then p.amount_minor else 0 end else 0 end)) as at_risk,
        count(*) as n
      from public.workspace_subscriptions s join public.billing_prices p on p.id = s.price_id
      where s.status in ('active', 'past_due', 'grace')
      group by p.currency
    ) m
  ),
  subs as (
    select
      (select count(*) from public.workspace_subscriptions where status = 'active') as active,
      (select count(*) from public.workspace_subscriptions where status in ('past_due', 'grace')) as at_risk,
      (select count(*) from public.workspace_subscriptions where created_at >= p_from and created_at < p_to and status <> 'incomplete') as started,
      (select count(*) from public.billing_subscription_events where to_status = 'cancelled' and created_at >= p_from and created_at < p_to) as cancelled,
      (select count(*) from public.billing_transactions where status in ('failed', 'amount_mismatch') and created_at >= p_from and created_at < p_to) as failed_payments,
      (select count(*) from public.billing_transactions where status = 'reversed' and updated_at >= p_from and updated_at < p_to) as reversed_payments
  ),
  days as (
    select generate_series(date_trunc('day', p_to - make_interval(days => v_days - 1)), date_trunc('day', p_to - interval '1 microsecond'), interval '1 day') as d
  ),
  series as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', to_char(d.d, 'YYYY-MM-DD'),
      'signups', (select count(*) from auth.users u where u.created_at >= d.d and u.created_at < d.d + interval '1 day'),
      'workspaces', (select count(*) from public.workspaces w where w.created_at >= d.d and w.created_at < d.d + interval '1 day'),
      'ai_calls', (select count(*) from public.ai_usage_events a where a.created_at >= d.d and a.created_at < d.d + interval '1 day'),
      'payments', (select count(*) from public.billing_transactions t where t.status = 'success' and t.paid_at >= d.d and t.paid_at < d.d + interval '1 day')
    ) order by d.d), '[]'::jsonb) as rows
    from days d
  ),
  tracking as (
    select jsonb_build_object(
      'users', (select min(created_at) from auth.users),
      'activity_log', (select min(created_at) from public.workspace_activity_log),
      'ai_usage', (select min(created_at) from public.ai_usage_events),
      'billing', (select min(created_at) from public.billing_transactions)
    ) as since
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'users', (select to_jsonb(users) from users),
    'workspaces', (select to_jsonb(workspaces) from workspaces),
    'product', (select to_jsonb(product) from product),
    'ai', (select to_jsonb(ai) from ai),
    'revenue', jsonb_build_object('by_currency', (select by_currency from revenue), 'mrr_by_currency', (select by_currency from mrr)),
    'subscriptions', (select to_jsonb(subs) from subs),
    'series', (select rows from series),
    'tracking_since', (select since from tracking)
  ) into v_result;

  return v_result;
end;
$$;

-- Real, current conditions that need a human. Severity and wording are
-- decided in _shared/admin/attention.ts; this only gathers facts.
create or replace function public.admin_attention_signals()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'failed_webhooks', coalesce((select jsonb_agg(x) from (
      select e.id, e.provider, e.event_type, e.processing_result, e.received_at as at, e.workspace_id, w.name as workspace_name
      from public.billing_webhook_events e left join public.workspaces w on w.id = e.workspace_id
      where e.processing_status = 'failed' and e.received_at >= now() - interval '7 days'
      order by e.received_at desc limit 20) x), '[]'::jsonb),
    'payment_problems', coalesce((select jsonb_agg(x) from (
      select t.id, t.reference, t.status, t.failure_reason, t.amount_minor, t.currency, t.created_at as at, t.workspace_id, w.name as workspace_name
      from public.billing_transactions t left join public.workspaces w on w.id = t.workspace_id
      where (t.status = 'amount_mismatch') or (t.status in ('failed', 'reversed') and t.updated_at >= now() - interval '7 days')
      order by t.updated_at desc limit 20) x), '[]'::jsonb),
    'subscriptions_at_risk', coalesce((select jsonb_agg(x) from (
      select s.id, s.status, s.grace_until, s.current_period_end, s.cancel_at_period_end, s.updated_at as at, s.workspace_id, w.name as workspace_name, bp.name as plan_name
      from public.workspace_subscriptions s join public.workspaces w on w.id = s.workspace_id left join public.billing_plans bp on bp.id = s.plan_id
      where s.status in ('past_due', 'grace')
         or (s.status = 'active' and s.cancel_at_period_end and s.current_period_end < now() + interval '14 days')
      order by s.updated_at desc limit 20) x), '[]'::jsonb),
    'automation_failures', coalesce((select jsonb_agg(x) from (
      select r.automation_id, a.name as automation_name, r.workspace_id, w.name as workspace_name, count(*) as failures, max(r.created_at) as at
      from public.automation_runs r join public.automations a on a.id = r.automation_id join public.workspaces w on w.id = r.workspace_id
      where r.status = 'failed' and r.created_at >= now() - interval '7 days'
      group by r.automation_id, a.name, r.workspace_id, w.name
      order by count(*) desc limit 20) x), '[]'::jsonb),
    'publishing_failures', coalesce((select jsonb_agg(x) from (
      select p.workspace_id, w.name as workspace_name, count(*) as failures, max(p.updated_at) as at
      from public.content_scheduled_posts p join public.workspaces w on w.id = p.workspace_id
      where p.status = 'failed' and p.updated_at >= now() - interval '7 days'
      group by p.workspace_id, w.name order by count(*) desc limit 20) x), '[]'::jsonb),
    'integration_problems', coalesce((select jsonb_agg(x) from (
      select i.id, i.provider::text as provider, i.status::text as status, i.last_health_check_status, i.token_expires_at, i.webhook_subscription_status,
             coalesce(i.last_health_check_at, i.updated_at) as at, i.workspace_id, w.name as workspace_name
      from public.workspace_integrations i join public.workspaces w on w.id = i.workspace_id
      where i.status = 'error'
         or (i.status = 'connected' and i.token_expires_at is not null and i.token_expires_at < now() + interval '7 days')
         or (i.status = 'connected' and i.last_health_check_status is not null and i.last_health_check_status not in ('ok', 'healthy', 'success'))
      order by coalesce(i.last_health_check_at, i.updated_at) desc limit 20) x), '[]'::jsonb),
    'message_dead_letters', coalesce((select jsonb_agg(x) from (
      select m.workspace_id, w.name as workspace_name, count(*) as failures, max(m.dead_lettered_at) as at
      from public.inbox_messages m join public.workspaces w on w.id = m.workspace_id
      where m.dead_lettered_at >= now() - interval '7 days'
      group by m.workspace_id, w.name order by count(*) desc limit 20) x), '[]'::jsonb),
    'ai_24h', (select jsonb_build_object('calls', count(*), 'failed', count(*) filter (where status = 'error'), 'at', max(created_at))
               from public.ai_usage_events where created_at >= now() - interval '24 hours'),
    'creative_failures', coalesce((select jsonb_agg(x) from (
      select c.workspace_id, w.name as workspace_name, count(*) as failures, max(c.updated_at) as at
      from public.creative_studio_concepts c join public.workspaces w on w.id = c.workspace_id
      where c.visual_status = 'failed' and c.updated_at >= now() - interval '7 days'
      group by c.workspace_id, w.name order by count(*) desc limit 20) x), '[]'::jsonb),
    'website_scan_failures', (select jsonb_build_object('failed', count(*) filter (where status = 'failed'), 'total', count(*), 'at', max(created_at))
                              from public.website_scans where created_at >= now() - interval '7 days'),
    'near_limits', coalesce((select jsonb_agg(x) from (
      select u.workspace_id, w.name as workspace_name, u.entitlement_key, u.used, e.limit_value, u.updated_at as at
      from public.entitlement_usage u
      join public.workspaces w on w.id = u.workspace_id
      cross join lateral (select ge.limit_value, ge.unlimited from public.get_workspace_entitlements(u.workspace_id) ge where ge.entitlement_key = u.entitlement_key) e
      where u.period_start = date_trunc('month', now())::date
        and not e.unlimited and e.limit_value > 0 and u.used >= e.limit_value * 0.8
      order by (u.used::numeric / e.limit_value) desc limit 20) x), '[]'::jsonb),
    'stale_checkouts', (select count(*) from public.billing_transactions where status = 'initialized' and created_at < now() - interval '24 hours' and created_at >= now() - interval '7 days')
  );
$$;

-- Recent business events. Metadata only - never message/lead content.
create or replace function public.admin_activity_feed(p_limit int default 40)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) from (
    (select 'user_signed_up' as kind, u.created_at as at, null::uuid as workspace_id, null::text as workspace_name, u.id as user_id, coalesce(p.full_name, '') as label
     from auth.users u left join public.profiles p on p.id = u.id order by u.created_at desc limit p_limit)
    union all
    (select 'workspace_created', w.created_at, w.id, w.name, w.created_by, w.name from public.workspaces w order by w.created_at desc limit p_limit)
    union all
    (select case t.status when 'success' then 'payment_succeeded' else 'payment_' || t.status end, coalesce(t.paid_at, t.updated_at), t.workspace_id, w.name, null, t.currency || ' ' || to_char(coalesce(t.paid_amount_minor, t.amount_minor) / 100.0, 'FM999G999G990D00')
     from public.billing_transactions t left join public.workspaces w on w.id = t.workspace_id
     where t.status in ('success', 'failed', 'reversed', 'amount_mismatch') order by coalesce(t.paid_at, t.updated_at) desc limit p_limit)
    union all
    (select 'subscription_' || e.to_status, e.created_at, e.workspace_id, w.name, null, coalesce(e.from_status, 'new') || ' → ' || e.to_status
     from public.billing_subscription_events e left join public.workspaces w on w.id = e.workspace_id order by e.created_at desc limit p_limit)
    union all
    (select 'automation_failed', r.created_at, r.workspace_id, w.name, null, a.name
     from public.automation_runs r join public.automations a on a.id = r.automation_id left join public.workspaces w on w.id = r.workspace_id
     where r.status = 'failed' order by r.created_at desc limit p_limit)
    union all
    (select 'integration_connected', i.connected_at, i.workspace_id, w.name, i.connected_by, i.provider::text
     from public.workspace_integrations i left join public.workspaces w on w.id = i.workspace_id
     where i.connected_at is not null order by i.connected_at desc limit p_limit)
    union all
    (select 'lead_created', l.created_at, l.workspace_id, w.name, null, coalesce(l.source, '')
     from public.leads l left join public.workspaces w on w.id = l.workspace_id order by l.created_at desc limit p_limit)
    order by at desc nulls last
    limit p_limit
  ) x;
$$;

create or replace function public.admin_users_page(p_search text, p_filter text, p_limit int, p_offset int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_like text := public._admin_like(p_search);
  v_has_search boolean := coalesce(trim(p_search), '') <> '';
  v_result jsonb;
begin
  with base as (
    select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at, p.full_name, r.role as admin_role
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.platform_admin_roles r on r.user_id = u.id
    where (not v_has_search or u.email ilike v_like or p.full_name ilike v_like or u.id::text = trim(p_search))
      and case coalesce(p_filter, 'all')
        when 'new_7d' then u.created_at >= now() - interval '7 days'
        when 'inactive_30d' then coalesce(u.last_sign_in_at, u.created_at) < now() - interval '30 days'
        when 'unconfirmed' then u.email_confirmed_at is null
        when 'no_workspace' then not exists (select 1 from public.workspace_members m where m.user_id = u.id)
        when 'staff' then r.role is not null
        else true end
  ),
  page as (
    select * from base order by created_at desc limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', pg.id, 'email', pg.email, 'full_name', pg.full_name, 'created_at', pg.created_at, 'last_sign_in_at', pg.last_sign_in_at,
      'email_confirmed', pg.email_confirmed_at is not null, 'admin_role', pg.admin_role,
      'workspaces', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'role', m.role, 'status', coalesce(wb.status, 'active')) order by m.created_at)
        from public.workspace_members m join public.workspaces w on w.id = m.workspace_id left join public.workspace_billing wb on wb.workspace_id = w.id
        where m.user_id = pg.id), '[]'::jsonb)
    ) order by pg.created_at desc) from page pg), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_workspaces_page(p_search text, p_filter text, p_limit int, p_offset int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_like text := public._admin_like(p_search);
  v_has_search boolean := coalesce(trim(p_search), '') <> '';
  v_result jsonb;
begin
  with base as (
    select w.id, w.name, w.slug, w.created_at, w.created_by, coalesce(wb.status, 'active') as status,
      public._admin_workspace_is_paying(w.id) as paying,
      (select max(l.created_at) from public.workspace_activity_log l where l.workspace_id = w.id) as last_activity_at
    from public.workspaces w
    left join public.workspace_billing wb on wb.workspace_id = w.id
    where (not v_has_search or w.name ilike v_like or w.slug ilike v_like or w.id::text = trim(p_search)
           or exists (select 1 from public.workspace_members m join auth.users u on u.id = m.user_id where m.workspace_id = w.id and u.email ilike v_like))
  ),
  filtered as (
    select * from base where case coalesce(p_filter, 'all')
      when 'paying' then paying
      when 'free' then not paying
      when 'suspended' then status = 'suspended'
      when 'new_30d' then created_at >= now() - interval '30 days'
      when 'inactive_30d' then coalesce(last_activity_at, created_at) < now() - interval '30 days'
      else true end
  ),
  page as (
    select * from filtered order by created_at desc limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', pg.id, 'name', pg.name, 'slug', pg.slug, 'created_at', pg.created_at, 'status', pg.status, 'paying', pg.paying,
      'last_activity_at', pg.last_activity_at,
      'plan_codes', public.workspace_plan_codes(pg.id),
      'members', (select count(*) from public.workspace_members m where m.workspace_id = pg.id),
      'owner', (select jsonb_build_object('id', u.id, 'email', u.email, 'full_name', p.full_name)
                from public.workspace_members m join auth.users u on u.id = m.user_id left join public.profiles p on p.id = u.id
                where m.workspace_id = pg.id and m.role = 'owner' order by m.created_at limit 1),
      'country_code', (select bi.country_code from public.business_identities bi where bi.workspace_id = pg.id limit 1),
      'revenue', coalesce((select jsonb_agg(jsonb_build_object('currency', c, 'gross_minor', g)) from (
          select coalesce(t.paid_currency, t.currency) as c, sum(coalesce(t.paid_amount_minor, t.amount_minor)) as g
          from public.billing_transactions t where t.workspace_id = pg.id and t.status = 'success' group by 1) rv), '[]'::jsonb)
    ) order by pg.created_at desc) from page pg), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when u.id is null then null else jsonb_build_object(
    'id', u.id, 'email', u.email, 'full_name', p.full_name, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
    'email_confirmed_at', u.email_confirmed_at, 'providers', coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb),
    'admin_role', (select role from public.platform_admin_roles r where r.user_id = u.id),
    'workspaces', coalesce((select jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.name, 'role', m.role, 'joined_at', coalesce(m.joined_at, m.created_at), 'status', coalesce(wb.status, 'active'),
        'plan_codes', public.workspace_plan_codes(w.id)) order by m.created_at)
      from public.workspace_members m join public.workspaces w on w.id = m.workspace_id left join public.workspace_billing wb on wb.workspace_id = w.id
      where m.user_id = u.id), '[]'::jsonb),
    'legal', coalesce((select jsonb_agg(jsonb_build_object('document_type', a.document_type, 'version', a.document_version, 'accepted_at', a.accepted_at) order by a.accepted_at desc)
      from public.legal_acceptances a where a.user_id = u.id), '[]'::jsonb),
    'ai_30d', (select jsonb_build_object('calls', count(*), 'tokens', coalesce(sum(total_tokens), 0), 'cost_usd', coalesce(sum(estimated_cost), 0))
      from public.ai_usage_events e where e.user_id = u.id and e.created_at >= now() - interval '30 days'),
    'recent_activity', coalesce((select jsonb_agg(x) from (
      select l.action, l.target_type, l.created_at, l.workspace_id, w.name as workspace_name
      from public.workspace_activity_log l left join public.workspaces w on w.id = l.workspace_id
      where l.actor_user_id = u.id order by l.created_at desc limit 25) x), '[]'::jsonb),
    'admin_history', coalesce((select jsonb_agg(x) from (
      select a.action, a.target_type, a.reason, a.created_at, op.full_name as operator_name
      from public.platform_admin_audit a left join public.profiles op on op.id = a.operator_user_id
      where a.target_type in ('user', 'admin_role') and a.target_id = u.id::text order by a.created_at desc limit 25) x), '[]'::jsonb)
  ) end
  from (select p_user_id as id) req
  left join auth.users u on u.id = req.id
  left join public.profiles p on p.id = u.id;
$$;

create or replace function public.admin_workspace_detail(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when w.id is null then null else jsonb_build_object(
    'id', w.id, 'name', w.name, 'slug', w.slug, 'created_at', w.created_at,
    'status', coalesce(wb.status, 'active'), 'trial_ends_at', wb.trial_ends_at,
    'plan_codes', public.workspace_plan_codes(w.id), 'paying', public._admin_workspace_is_paying(w.id),
    'settings', (select jsonb_build_object('timezone', s.timezone, 'currency', s.currency, 'industry', s.industry, 'website', s.website) from public.workspace_settings s where s.workspace_id = w.id),
    'identity', (select jsonb_build_object('legal_name', bi.legal_name, 'trading_name', bi.trading_name, 'country_code', bi.country_code, 'industry', bi.industry, 'verification_status', bi.verification_status)
                 from public.business_identities bi where bi.workspace_id = w.id limit 1),
    'hosted_profile', (select jsonb_build_object('slug', h.slug, 'is_published', h.is_published, 'published_at', h.published_at) from public.hosted_profiles h where h.workspace_id = w.id),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', u.id, 'email', u.email, 'full_name', p.full_name, 'role', m.role,
        'joined_at', coalesce(m.joined_at, m.created_at), 'last_sign_in_at', u.last_sign_in_at) order by m.created_at)
      from public.workspace_members m join auth.users u on u.id = m.user_id left join public.profiles p on p.id = u.id where m.workspace_id = w.id), '[]'::jsonb),
    'pending_invitations', (select count(*) from public.workspace_invitations i where i.workspace_id = w.id and i.status = 'pending'),
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'plan', bp.name, 'plan_code', bp.code,
        'amount_minor', pr.amount_minor, 'currency', pr.currency, 'interval', pr.billing_interval, 'provider', s.provider,
        'current_period_end', s.current_period_end, 'grace_until', s.grace_until, 'cancel_at_period_end', s.cancel_at_period_end,
        'created_at', s.created_at, 'cancelled_at', s.cancelled_at) order by s.created_at desc)
      from public.workspace_subscriptions s left join public.billing_plans bp on bp.id = s.plan_id left join public.billing_prices pr on pr.id = s.price_id
      where s.workspace_id = w.id), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(jsonb_build_object('id', pu.id, 'status', pu.status, 'plan', bp.name, 'amount_minor', pu.amount_minor, 'currency', pu.currency,
        'paid_at', pu.paid_at, 'access_expires_at', pu.access_expires_at) order by pu.created_at desc)
      from public.workspace_purchases pu left join public.billing_plans bp on bp.id = pu.plan_id where pu.workspace_id = w.id), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(x) from (
      select t.id, t.reference, t.kind, t.status, t.amount_minor, t.currency, t.paid_amount_minor, t.paid_currency, t.paid_at, t.failure_reason, t.created_at
      from public.billing_transactions t where t.workspace_id = w.id order by t.created_at desc limit 25) x), '[]'::jsonb),
    'usage', coalesce((select jsonb_agg(jsonb_build_object('key', e.entitlement_key, 'kind', e.kind, 'enabled', e.enabled, 'limit', e.limit_value,
        'unlimited', e.unlimited, 'used', e.used, 'source', e.source) order by e.entitlement_key)
      from public.get_workspace_entitlements(w.id) e), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(to_jsonb(o) - 'workspace_id') from public.workspace_entitlement_overrides o where o.workspace_id = w.id), '[]'::jsonb),
    'integrations', coalesce((select jsonb_agg(jsonb_build_object('provider', i.provider, 'status', i.status, 'connected_at', i.connected_at,
        'last_health_check_at', i.last_health_check_at, 'last_health_check_status', i.last_health_check_status, 'last_success_at', i.last_success_at,
        'token_expires_at', i.token_expires_at, 'webhook_subscription_status', i.webhook_subscription_status))
      from public.workspace_integrations i where i.workspace_id = w.id), '[]'::jsonb),
    'whatsapp_numbers', coalesce((select jsonb_agg(jsonb_build_object('display_phone_number', n.display_phone_number, 'verified_name', n.verified_name,
        'is_active', n.is_active, 'quality_rating', n.quality_rating, 'platform_status', n.platform_status))
      from public.workspace_whatsapp_numbers n where n.workspace_id = w.id), '[]'::jsonb),
    'modules', jsonb_build_object(
      'leads', (select count(*) from public.leads where workspace_id = w.id),
      'customers', (select count(*) from public.customers where workspace_id = w.id),
      'opportunities', (select count(*) from public.opportunities where workspace_id = w.id),
      'conversations', (select count(*) from public.inbox_conversations where workspace_id = w.id),
      'messages_30d', (select count(*) from public.inbox_messages where workspace_id = w.id and created_at >= now() - interval '30 days'),
      'automations', (select count(*) from public.automations where workspace_id = w.id),
      'automations_active', (select count(*) from public.automations where workspace_id = w.id and status = 'active'),
      'automation_runs_30d', (select count(*) from public.automation_runs where workspace_id = w.id and created_at >= now() - interval '30 days'),
      'automation_failures_30d', (select count(*) from public.automation_runs where workspace_id = w.id and status = 'failed' and created_at >= now() - interval '30 days'),
      'posts_published', (select count(*) from public.content_scheduled_posts where workspace_id = w.id and status = 'published'),
      'posts_failed_30d', (select count(*) from public.content_scheduled_posts where workspace_id = w.id and status = 'failed' and updated_at >= now() - interval '30 days'),
      'creative_concepts', (select count(*) from public.creative_studio_concepts where workspace_id = w.id),
      'campaigns', (select count(*) from public.ad_campaigns where workspace_id = w.id),
      'website_scans', (select count(*) from public.website_scans where workspace_id = w.id),
      'ai_calls_30d', (select count(*) from public.ai_usage_events where workspace_id = w.id and created_at >= now() - interval '30 days'),
      'ai_tokens_30d', (select coalesce(sum(total_tokens), 0) from public.ai_usage_events where workspace_id = w.id and created_at >= now() - interval '30 days'),
      'ai_cost_usd_30d', (select coalesce(sum(estimated_cost), 0) from public.ai_usage_events where workspace_id = w.id and created_at >= now() - interval '30 days')
    ),
    'recent_activity', coalesce((select jsonb_agg(x) from (
      select l.action, l.target_type, l.created_at, op.full_name as actor_name
      from public.workspace_activity_log l left join public.profiles op on op.id = l.actor_user_id
      where l.workspace_id = w.id order by l.created_at desc limit 25) x), '[]'::jsonb),
    'admin_history', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      (select a.action, a.reason, a.created_at, op.full_name as operator_name from public.platform_admin_audit a left join public.profiles op on op.id = a.operator_user_id
       where a.workspace_id = w.id order by a.created_at desc limit 25)
      union all
      (select a.action, a.reason, a.created_at, op.full_name from public.platform_operator_actions a left join public.profiles op on op.id = a.operator_user_id
       where a.workspace_id = w.id order by a.created_at desc limit 25)) x), '[]'::jsonb)
  ) end
  from (select p_workspace_id as id) req
  left join public.workspaces w on w.id = req.id
  left join public.workspace_billing wb on wb.workspace_id = w.id;
$$;

create or replace function public.admin_search(p_q text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := trim(coalesce(p_q, ''));
  v_like text := public._admin_like(p_q);
begin
  if length(v_q) < 2 then
    return jsonb_build_object('users', '[]'::jsonb, 'workspaces', '[]'::jsonb, 'transactions', '[]'::jsonb, 'subscriptions', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(x) from (
      select u.id, u.email, p.full_name from auth.users u left join public.profiles p on p.id = u.id
      where u.email ilike v_like or p.full_name ilike v_like or u.id::text = v_q
      order by u.created_at desc limit 8) x), '[]'::jsonb),
    'workspaces', coalesce((select jsonb_agg(x) from (
      select w.id, w.name, w.slug from public.workspaces w
      where w.name ilike v_like or w.slug ilike v_like or w.id::text = v_q
      order by w.created_at desc limit 8) x), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(x) from (
      select t.id, t.reference, t.status, t.amount_minor, t.currency, t.workspace_id, w.name as workspace_name
      from public.billing_transactions t left join public.workspaces w on w.id = t.workspace_id
      where t.reference ilike v_like or t.id::text = v_q
      order by t.created_at desc limit 8) x), '[]'::jsonb),
    'subscriptions', coalesce((select jsonb_agg(x) from (
      select s.id, s.status, s.provider_subscription_code, s.workspace_id, w.name as workspace_name
      from public.workspace_subscriptions s left join public.workspaces w on w.id = s.workspace_id
      where s.provider_subscription_code ilike v_like or s.provider_customer_code ilike v_like or s.id::text = v_q
      order by s.created_at desc limit 8) x), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_revenue(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days int := least(greatest(ceil(extract(epoch from (p_to - p_from)) / 86400)::int, 1), 400);
begin
  if p_to <= p_from then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'by_currency', coalesce((select jsonb_agg(x order by x.currency) from (
      select coalesce(t.paid_currency, t.currency) as currency,
        sum(coalesce(t.paid_amount_minor, t.amount_minor)) filter (where t.status = 'success' and t.paid_at >= p_from and t.paid_at < p_to) as gross_minor,
        count(*) filter (where t.status = 'success' and t.paid_at >= p_from and t.paid_at < p_to) as successful,
        count(distinct t.workspace_id) filter (where t.status = 'success' and t.paid_at >= p_from and t.paid_at < p_to) as paying_workspaces,
        sum(coalesce(t.paid_amount_minor, t.amount_minor)) filter (where t.status = 'reversed' and t.updated_at >= p_from and t.updated_at < p_to) as reversed_minor,
        count(*) filter (where t.status in ('failed', 'amount_mismatch') and t.created_at >= p_from and t.created_at < p_to) as failed,
        count(*) filter (where t.status = 'abandoned' and t.created_at >= p_from and t.created_at < p_to) as abandoned
      from public.billing_transactions t
      group by 1) x where x.successful > 0 or x.failed > 0 or x.reversed_minor is not null), '[]'::jsonb),
    'by_plan', coalesce((select jsonb_agg(x order by x.gross_minor desc) from (
      select coalesce(bp.name, 'Unknown plan') as plan, bp.code as plan_code, coalesce(t.paid_currency, t.currency) as currency,
        sum(coalesce(t.paid_amount_minor, t.amount_minor)) as gross_minor, count(*) as transactions
      from public.billing_transactions t left join public.billing_prices pr on pr.id = t.price_id left join public.billing_plans bp on bp.id = pr.plan_id
      where t.status = 'success' and t.paid_at >= p_from and t.paid_at < p_to
      group by 1, 2, 3) x), '[]'::jsonb),
    'by_kind', coalesce((select jsonb_agg(x) from (
      select t.kind, coalesce(t.paid_currency, t.currency) as currency, sum(coalesce(t.paid_amount_minor, t.amount_minor)) as gross_minor, count(*) as transactions
      from public.billing_transactions t where t.status = 'success' and t.paid_at >= p_from and t.paid_at < p_to group by 1, 2) x), '[]'::jsonb),
    'mrr', coalesce((select jsonb_agg(x) from (
      select pr.currency,
        round(sum(case when s.status = 'active' then case pr.billing_interval when 'year' then pr.amount_minor / 12.0 when 'month' then pr.amount_minor else 0 end else 0 end)) as mrr_minor,
        round(sum(case when s.status in ('past_due', 'grace') then case pr.billing_interval when 'year' then pr.amount_minor / 12.0 when 'month' then pr.amount_minor else 0 end else 0 end)) as at_risk_minor,
        count(*) filter (where s.status = 'active') as active
      from public.workspace_subscriptions s join public.billing_prices pr on pr.id = s.price_id
      where s.status in ('active', 'past_due', 'grace') group by pr.currency) x), '[]'::jsonb),
    'subscriptions', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.workspace_subscriptions group by status) x), '{}'::jsonb),
      'started', (select count(*) from public.workspace_subscriptions where created_at >= p_from and created_at < p_to and status <> 'incomplete'),
      'cancelled', (select count(*) from public.billing_subscription_events where to_status = 'cancelled' and created_at >= p_from and created_at < p_to),
      'expired', (select count(*) from public.billing_subscription_events where to_status = 'expired' and created_at >= p_from and created_at < p_to),
      'renewals', (select count(*) from public.billing_transactions where kind = 'subscription_renewal' and status = 'success' and paid_at >= p_from and paid_at < p_to)
    ),
    'series', coalesce((select jsonb_agg(x order by x.date, x.currency) from (
      select to_char(d.d, 'YYYY-MM-DD') as date, c.currency,
        (select coalesce(sum(coalesce(t.paid_amount_minor, t.amount_minor)), 0) from public.billing_transactions t
          where t.status = 'success' and coalesce(t.paid_currency, t.currency) = c.currency and t.paid_at >= d.d and t.paid_at < d.d + interval '1 day') as gross_minor
      from generate_series(date_trunc('day', p_to - make_interval(days => v_days - 1)), date_trunc('day', p_to - interval '1 microsecond'), interval '1 day') d(d)
      cross join (select distinct coalesce(paid_currency, currency) as currency from public.billing_transactions where status = 'success') c) x), '[]'::jsonb),
    'tracking_since', (select min(created_at) from public.billing_transactions)
  );
end;
$$;

-- Admin user management needs to resolve an email to an account.
create or replace function public.admin_find_user_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

create or replace function public.admin_staff()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'role', r.role, 'email', u.email, 'full_name', p.full_name,
    'granted_by_name', g.full_name, 'created_at', r.created_at, 'updated_at', r.updated_at, 'last_sign_in_at', u.last_sign_in_at) order by r.created_at), '[]'::jsonb)
  from public.platform_admin_roles r
  join auth.users u on u.id = r.user_id
  left join public.profiles p on p.id = r.user_id
  left join public.profiles g on g.id = r.granted_by;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public._admin_workspace_is_paying(uuid)',
    'public.admin_overview(timestamptz, timestamptz)',
    'public.admin_attention_signals()',
    'public.admin_activity_feed(int)',
    'public.admin_users_page(text, text, int, int)',
    'public.admin_workspaces_page(text, text, int, int)',
    'public.admin_user_detail(uuid)',
    'public.admin_workspace_detail(uuid)',
    'public.admin_search(text)',
    'public.admin_revenue(timestamptz, timestamptz)',
    'public.admin_find_user_by_email(text)',
    'public.admin_staff()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

revoke execute on function public.platform_admin_roles_keep_owner() from public, anon, authenticated;
revoke execute on function public.platform_admin_roles_sync_operator_flag() from public, anon, authenticated;
revoke execute on function public.platform_admin_audit_append_only() from public, anon, authenticated;
