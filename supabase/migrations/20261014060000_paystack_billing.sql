-- Paystack billing: customers, transactions, webhook event log, subscription
-- state history, platform settings, and the ATOMIC functions that are the
-- only way paid access is ever granted.
--
-- Design decisions:
--  * Paid access = workspace_subscriptions / workspace_purchases rows in a
--    granting state (see get_workspace_entitlements). Those rows change
--    ONLY inside the SECURITY DEFINER functions below, which run in one
--    transaction under a row lock on the billing_transactions row, so a
--    duplicate webhook, a webhook racing the verify call, or a retried
--    reconcile can never double-apply or skip a payment.
--  * Every charge is matched by OUR reference (billing_transactions,
--    created at checkout) - never by metadata in the provider payload, which
--    the payer's browser can influence. Amount and currency must match what
--    we asked for; an underpayment is recorded ('amount_mismatch') and
--    grants nothing.
--  * Renewals (which carry a Paystack-generated reference) are matched by
--    the provider subscription code we stored when the subscription was
--    created, and inserted as their own billing_transactions row, so the
--    unique reference is still the idempotency key.
--  * Webhook events are stored raw with a sha256 dedupe key of the body
--    (Paystack sends no event id; a redelivery is byte-identical).
--  * All tables are service-role written. Members can read their own
--    workspace's transactions and subscription history (billing page);
--    webhook events and customer mappings are platform-only.
-- ---------------------------------------------------------------------------

-- Platform settings (admin-editable routine configuration) ------------------------

create table if not exists public.platform_settings (
  key text primary key check (key ~ '^[a-z0-9_.]{2,80}$'),
  value jsonb not null,
  description text check (description is null or length(description) <= 500),
  -- Public settings (support contact, notices, pricing copy) are readable
  -- by anyone including logged-out visitors. Never put a secret here -
  -- credentials live in edge-function secrets, not the database.
  is_public boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

drop trigger if exists set_platform_settings_updated_at on public.platform_settings;
create trigger set_platform_settings_updated_at before update on public.platform_settings
  for each row execute function public.set_updated_at();

alter table public.platform_settings enable row level security;
drop policy if exists "platform_settings_read_public" on public.platform_settings;
create policy "platform_settings_read_public" on public.platform_settings for select to anon, authenticated using (is_public);

insert into public.platform_settings (key, value, description, is_public) values
  ('billing.grace_days', '7'::jsonb, 'Days a subscription keeps access after an unpaid renewal before expiring.', false),
  ('billing.pending_abandon_hours', '24'::jsonb, 'Hours after which an unpaid checkout is marked abandoned.', false),
  ('support.contact', '{"email": null, "phone": null, "whatsapp": null}'::jsonb, 'Support contact details shown to customers.', true),
  ('platform.notice', '{"enabled": false, "message": "", "tone": "info"}'::jsonb, 'Platform-wide notice banner.', true)
on conflict (key) do nothing;

create or replace function public.platform_setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::integer from public.platform_settings where key = p_key), p_default);
$$;

-- Customers ---------------------------------------------------------------------------

create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null default 'paystack' check (provider in ('paystack')),
  provider_customer_code text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- NOT unique on provider_customer_code: Paystack has one customer per
  -- email, so an owner buying for two workspaces shares one customer code.
  -- Subscriptions are matched on the code stored on the subscription row.
  unique (workspace_id, provider)
);
create index if not exists billing_customers_code_idx on public.billing_customers (provider, provider_customer_code);

-- Transactions ------------------------------------------------------------------------

create table if not exists public.billing_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null default 'paystack' check (provider in ('paystack')),
  reference text not null unique check (length(reference) between 6 and 120),
  kind text not null check (kind in ('purchase', 'subscription_initial', 'subscription_renewal')),
  purchase_id uuid references public.workspace_purchases(id) on delete set null,
  subscription_id uuid references public.workspace_subscriptions(id) on delete set null,
  price_id uuid references public.billing_prices(id) on delete set null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'initialized'
    check (status in ('initialized', 'success', 'failed', 'abandoned', 'amount_mismatch', 'reversed')),
  paid_amount_minor bigint,
  paid_currency text,
  paid_at timestamptz,
  verified_via text check (verified_via is null or verified_via in ('webhook', 'verify_api', 'reconcile')),
  failure_reason text check (failure_reason is null or length(failure_reason) <= 500),
  authorization_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_transactions_workspace_idx on public.billing_transactions (workspace_id, created_at desc);
create index if not exists billing_transactions_pending_idx on public.billing_transactions (created_at) where status = 'initialized';

-- Webhook event log --------------------------------------------------------------------

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paystack',
  dedupe_key text not null unique,
  event_type text not null,
  signature_valid boolean not null,
  payload jsonb not null,
  processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  processing_result text check (processing_result is null or length(processing_result) <= 1000),
  workspace_id uuid references public.workspaces(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists billing_webhook_events_received_idx on public.billing_webhook_events (received_at desc);
create index if not exists billing_webhook_events_status_idx on public.billing_webhook_events (processing_status, received_at desc);

-- Subscription state history ---------------------------------------------------------

create table if not exists public.billing_subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.workspace_subscriptions(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text not null check (length(reason) <= 500),
  actor text not null default 'system' check (actor in ('system', 'webhook', 'verify_api', 'reconcile', 'customer', 'operator')),
  created_at timestamptz not null default now()
);
create index if not exists billing_subscription_events_sub_idx on public.billing_subscription_events (subscription_id, created_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['billing_customers', 'billing_transactions']
  loop
    execute format('drop trigger if exists set_%1$s_updated_at on public.%1$I', t);
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end
$$;

alter table public.billing_customers enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.billing_transactions enable row level security;
alter table public.billing_subscription_events enable row level security;

drop policy if exists "billing_transactions_select_member" on public.billing_transactions;
create policy "billing_transactions_select_member" on public.billing_transactions for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "billing_subscription_events_select_member" on public.billing_subscription_events;
create policy "billing_subscription_events_select_member" on public.billing_subscription_events for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Helpers --------------------------------------------------------------------------------

create or replace function public.billing_interval_to_interval(p_interval text)
returns interval
language sql
immutable
as $$
  select case p_interval when 'month' then interval '1 month' when 'year' then interval '1 year' else null end;
$$;

create or replace function public.billing_log_subscription_event(p_sub public.workspace_subscriptions, p_from text, p_to text, p_reason text, p_actor text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.billing_subscription_events (subscription_id, workspace_id, from_status, to_status, reason, actor)
  values (p_sub.id, p_sub.workspace_id, p_from, p_to, left(p_reason, 500), p_actor);
$$;

-- Apply a successful charge against OUR reference. The single grant path
-- for once-off purchases and first subscription payments.
create or replace function public.billing_apply_charge_success(
  p_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_paid_at timestamptz,
  p_via text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.billing_transactions;
  v_price public.billing_prices;
  v_sub public.workspace_subscriptions;
  v_other public.workspace_subscriptions;
  v_replaced boolean := false;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
begin
  select * into v_txn from public.billing_transactions where reference = p_reference for update;
  if v_txn.id is null then
    return 'unknown_reference';
  end if;
  if v_txn.status = 'success' then
    return 'duplicate';
  end if;
  if v_txn.status not in ('initialized', 'failed', 'abandoned') then
    return 'not_applicable:' || v_txn.status;
  end if;

  if upper(coalesce(p_currency, '')) <> v_txn.currency or coalesce(p_amount_minor, -1) < v_txn.amount_minor then
    update public.billing_transactions
    set status = 'amount_mismatch', paid_amount_minor = p_amount_minor, paid_currency = upper(p_currency), paid_at = v_paid_at,
        verified_via = p_via, failure_reason = format('Expected %s %s, received %s %s', v_txn.amount_minor, v_txn.currency, p_amount_minor, p_currency)
    where id = v_txn.id;
    return 'amount_mismatch';
  end if;

  update public.billing_transactions
  set status = 'success', paid_amount_minor = p_amount_minor, paid_currency = upper(p_currency), paid_at = v_paid_at,
      verified_via = p_via, failure_reason = null
  where id = v_txn.id;

  if v_txn.kind = 'purchase' then
    select * into v_price from public.billing_prices where id = v_txn.price_id;
    update public.workspace_purchases
    set status = 'paid', paid_at = v_paid_at,
        access_expires_at = case when v_price.access_days is null then null else v_paid_at + make_interval(days => v_price.access_days) end
    where id = v_txn.purchase_id;
    return 'applied';
  end if;

  if v_txn.kind = 'subscription_initial' then
    select * into v_sub from public.workspace_subscriptions where id = v_txn.subscription_id for update;
    select * into v_price from public.billing_prices where id = v_sub.price_id;
    -- A plan change: the previous live subscription is replaced. The
    -- caller disables it at the provider (returned as 'applied_replaced').
    for v_other in
      select * from public.workspace_subscriptions
      where workspace_id = v_sub.workspace_id and id <> v_sub.id and status in ('active', 'past_due', 'grace')
      for update
    loop
      update public.workspace_subscriptions set status = 'expired', cancelled_at = now() where id = v_other.id;
      perform public.billing_log_subscription_event(v_other, v_other.status, 'expired', 'Replaced by a new subscription', p_via);
      v_replaced := true;
    end loop;

    update public.workspace_subscriptions
    set status = 'active',
        current_period_start = v_paid_at,
        current_period_end = coalesce(current_period_end, v_paid_at + public.billing_interval_to_interval(v_price.billing_interval)),
        grace_until = null
    where id = v_sub.id;
    perform public.billing_log_subscription_event(v_sub, v_sub.status, 'active', 'First payment received', p_via);
    return case when v_replaced then 'applied_replaced' else 'applied' end;
  end if;

  return 'applied';
end;
$$;

-- Link the provider's subscription code (subscription.create) to the
-- subscription row we created at checkout for this customer + plan.
create or replace function public.billing_link_provider_subscription(
  p_customer_code text,
  p_plan_code text,
  p_subscription_code text,
  p_email_token text,
  p_next_payment_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.workspace_subscriptions;
begin
  if exists (select 1 from public.workspace_subscriptions where provider_subscription_code = p_subscription_code) then
    update public.workspace_subscriptions
    set provider_email_token = coalesce(p_email_token, provider_email_token),
        current_period_end = coalesce(p_next_payment_at, current_period_end)
    where provider_subscription_code = p_subscription_code;
    return 'already_linked';
  end if;

  -- Matched on the customer code captured on the subscription at checkout
  -- (a customer code can span several workspaces of the same owner).
  select s.* into v_sub
  from public.workspace_subscriptions s
  join public.billing_prices p on p.id = s.price_id
  where s.provider_customer_code = p_customer_code
    and s.provider_subscription_code is null
    and p.paystack_plan_code = p_plan_code
    and s.status in ('incomplete', 'active')
  order by (s.status = 'active') desc, s.created_at desc
  limit 1
  for update of s;

  if v_sub.id is null then
    return 'no_matching_subscription';
  end if;

  update public.workspace_subscriptions
  set provider_subscription_code = p_subscription_code,
      provider_customer_code = p_customer_code,
      provider_email_token = p_email_token,
      current_period_end = coalesce(p_next_payment_at, current_period_end)
  where id = v_sub.id;
  return 'linked';
end;
$$;

-- A renewal charge on an existing provider subscription.
create or replace function public.billing_apply_renewal(
  p_subscription_code text,
  p_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_paid_at timestamptz,
  p_next_payment_at timestamptz,
  p_via text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.workspace_subscriptions;
  v_price public.billing_prices;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
begin
  select * into v_sub from public.workspace_subscriptions where provider_subscription_code = p_subscription_code for update;
  if v_sub.id is null then
    return 'unknown_subscription';
  end if;
  if exists (select 1 from public.billing_transactions where reference = p_reference) then
    return 'duplicate';
  end if;
  select * into v_price from public.billing_prices where id = v_sub.price_id;

  if upper(coalesce(p_currency, '')) <> v_price.currency or coalesce(p_amount_minor, -1) < v_price.amount_minor then
    insert into public.billing_transactions (workspace_id, reference, kind, subscription_id, price_id, amount_minor, currency, status,
      paid_amount_minor, paid_currency, paid_at, verified_via, failure_reason)
    values (v_sub.workspace_id, p_reference, 'subscription_renewal', v_sub.id, v_price.id, v_price.amount_minor, v_price.currency, 'amount_mismatch',
      p_amount_minor, upper(p_currency), v_paid_at, p_via, 'Renewal amount below the subscribed price');
    return 'amount_mismatch';
  end if;

  insert into public.billing_transactions (workspace_id, reference, kind, subscription_id, price_id, amount_minor, currency, status,
    paid_amount_minor, paid_currency, paid_at, verified_via)
  values (v_sub.workspace_id, p_reference, 'subscription_renewal', v_sub.id, v_price.id, v_price.amount_minor, v_price.currency, 'success',
    p_amount_minor, upper(p_currency), v_paid_at, p_via);

  if v_sub.status in ('expired') then
    return 'renewal_on_expired_subscription';
  end if;

  update public.workspace_subscriptions
  set status = case when status = 'cancelled' then 'cancelled' else 'active' end,
      current_period_start = v_paid_at,
      current_period_end = coalesce(p_next_payment_at, v_paid_at + public.billing_interval_to_interval(v_price.billing_interval)),
      grace_until = null
  where id = v_sub.id;
  if v_sub.status not in ('active', 'cancelled') then
    perform public.billing_log_subscription_event(v_sub, v_sub.status, 'active', 'Renewal payment received', p_via);
  end if;
  return 'applied';
end;
$$;

-- Guarded status transition (optimistic: only applies from the expected
-- status). The allowed-transition matrix is enforced here so no caller -
-- webhook, reconcile or operator tooling - can make an illegal jump.
create or replace function public.billing_transition_subscription(
  p_subscription_id uuid,
  p_expected_from text,
  p_to text,
  p_reason text,
  p_actor text,
  p_grace_until timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.workspace_subscriptions;
begin
  select * into v_sub from public.workspace_subscriptions where id = p_subscription_id for update;
  if v_sub.id is null or v_sub.status <> p_expected_from then
    return false;
  end if;
  if not (
    (p_expected_from = 'incomplete' and p_to in ('expired')) or
    (p_expected_from = 'active' and p_to in ('past_due', 'grace', 'cancelled', 'expired')) or
    (p_expected_from = 'past_due' and p_to in ('active', 'grace', 'cancelled', 'expired')) or
    (p_expected_from = 'grace' and p_to in ('active', 'cancelled', 'expired')) or
    (p_expected_from = 'cancelled' and p_to in ('expired'))
  ) then
    raise exception 'Illegal subscription transition % -> %', p_expected_from, p_to using errcode = '22023';
  end if;

  update public.workspace_subscriptions
  set status = p_to,
      grace_until = case when p_to = 'grace' then p_grace_until when p_to = 'active' then null else grace_until end,
      cancelled_at = case when p_to in ('cancelled', 'expired') and cancelled_at is null then now() else cancelled_at end,
      cancel_at_period_end = case when p_to = 'cancelled' then true else cancel_at_period_end end
  where id = v_sub.id;
  perform public.billing_log_subscription_event(v_sub, p_expected_from, p_to, p_reason, p_actor);
  return true;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.billing_apply_charge_success(text, bigint, text, timestamptz, text)',
    'public.billing_link_provider_subscription(text, text, text, text, timestamptz)',
    'public.billing_apply_renewal(text, text, bigint, text, timestamptz, timestamptz, text)',
    'public.billing_transition_subscription(uuid, text, text, text, text, timestamptz)',
    'public.billing_log_subscription_event(public.workspace_subscriptions, text, text, text, text)',
    'public.platform_setting_int(text, integer)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;

-- Reconcile tick schedule (every 15 minutes). Same vault + pg_cron + pg_net
-- pattern as automations-tick. BILLING_CRON_SECRET must be set as an
-- edge-function secret from vault (billing_cron_secret) as a separate,
-- uncommitted step; until then the tick rejects every call.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'billing_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'billing_cron_secret');
  end if;
exception
  when undefined_table or invalid_schema_name or undefined_function then
    null;
end
$$;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'billing-reconcile-tick' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'billing-reconcile-tick',
    '*/15 * * * *',
    $cron$
    select net.http_post(
      url := 'https://doarqrjpadejksovxeev.supabase.co/functions/v1/billing-reconcile-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'billing_cron_secret')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
exception
  when undefined_table or invalid_schema_name or undefined_function then
    null;
end
$$;
