-- Phase G (Attribution & Conversion Tracking).
--
-- Extends the Phase 2 attribution_events table (raw touchpoint stream)
-- rather than replacing it - durable rule: "use the existing schema if it
-- already covers these needs and migrate minimally." Nothing has ever
-- written to this table yet (grep confirms zero call sites before this
-- migration), so the polymorphic subject_type/subject_id pair it shipped
-- with is replaced outright by explicit, individually-workspace-validated
-- FK columns - a real Postgres FK (and a trigger that can check it against
-- the right table per column) is strictly better than a text-typed
-- polymorphic pair for exactly the "cross-workspace link must be
-- impossible" requirement this phase is built around, and there is no
-- existing data or code to migrate away from.
--
-- Core principle (never violated below): a touchpoint with no known
-- campaign is VALID, not an error. Every campaign/ad/creative/conversation/
-- lead/opportunity/customer column here is nullable. Unknown is better
-- than incorrect.

-- 1. Bug fix discovered while investigating actual Meta referral payload
--    shape (durable instruction: "do not assume Meta provides fields it
--    does not provide"): the WhatsApp inbound referral object Meta sends
--    for a Click-to-WhatsApp ad is {source_type, source_id, headline,
--    ctwa_clid} - there is no campaign_id field. source_id (when
--    source_type='ad') is the AD's id, already correctly stored in
--    referral_ad_id. ctwa_clid is an opaque per-CLICK identifier (Meta's
--    Click-to-WhatsApp Click ID, analogous to fbclid), not a campaign id -
--    it was being written into a column named referral_campaign_id, which
--    is simply wrong. Nothing reads this column today (grepped), so this
--    is a safe rename to its true meaning rather than a breaking change.
alter table public.inbox_conversations
  rename column referral_campaign_id to referral_click_id;

comment on column public.inbox_conversations.referral_click_id is
  'Meta''s ctwa_clid (Click-to-WhatsApp Click ID) from the inbound referral object - an opaque per-click identifier, NOT a campaign id. Meta''s referral payload never includes a campaign id directly; the real campaign/ad_set/creative chain for this conversation, when resolvable, is derived server-side by matching referral_ad_id against this workspace''s own ads.external_ad_id - see attribution_events rows with conversation_id = this row''s id.';

-- 2. attribution_events - extended -------------------------------------------

alter table public.attribution_events
  drop column if exists subject_type,
  drop column if exists subject_id;

alter table public.attribution_events
  -- Internal, StabiFlow-owned object references - set only when StabiFlow
  -- itself can deterministically resolve them (e.g. an inbound WhatsApp
  -- referral's ad_id matches a row in this workspace's own `ads` table).
  -- Never required: external_* below is the "we at least know the raw
  -- provider id" fallback when internal resolution isn't possible.
  add column if not exists campaign_id uuid references public.ad_campaigns(id) on delete set null,
  add column if not exists ad_set_id uuid references public.ad_sets(id) on delete set null,
  add column if not exists ad_id uuid references public.ads(id) on delete set null,
  add column if not exists creative_id uuid references public.ad_creatives(id) on delete set null,

  -- What this touchpoint is linked to. All independently nullable and all
  -- ADDITIVE over an entity's lifetime (durable rule #17/#18/#19): a
  -- touchpoint recorded when a conversation started gets its lead_id
  -- backfilled once that conversation becomes a lead, its opportunity_id
  -- backfilled once an opportunity is created from that lead, and its
  -- customer_id backfilled once that opportunity is won - the ORIGINAL row
  -- (occurred_at, source evidence) is never rewritten, only extended. This
  -- is what lets an opportunity/customer resolve its attribution through
  -- the touchpoint without duplicating rows at every funnel stage.
  add column if not exists conversation_id uuid references public.inbox_conversations(id) on delete set null,
  add column if not exists lead_id uuid references public.leads(id) on delete set null,
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null,
  add column if not exists customer_id uuid references public.customers(id) on delete set null,

  -- Classification, deliberately kept separate from `platform` (which
  -- answers "which provider" - meta/google/tiktok/organic/direct/
  -- referral): source_type answers "is this paid" (needed for
  -- first_paid_touch/last_paid_touch), source/medium mirror UTM
  -- source/medium semantics even for non-UTM touchpoints (e.g. a
  -- Click-to-WhatsApp ad's source='meta', medium='paid_social' even
  -- though no literal utm_ params were ever involved).
  add column if not exists source_type text check (source_type in ('paid', 'organic', 'direct', 'referral', 'unknown')),
  add column if not exists source text,
  add column if not exists medium text,

  -- Generic UTM/source foundation (durable rule #13/#39) - unused by any
  -- Meta/WhatsApp path today, present so a future website/Google Ads flow
  -- reuses this same table rather than inventing a parallel one.
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists referrer text,
  add column if not exists destination text,

  -- How the attribution/source above was established - separate from
  -- attribution_confidence (how much we trust it). 'probabilistic_future'
  -- is reserved, not implemented - durable rule #5.
  add column if not exists attribution_method text check (attribution_method in ('deterministic', 'provider_reported', 'exact_match', 'manual', 'probabilistic_future')),

  -- Generic click/session identifier - e.g. Meta's ctwa_clid, a future
  -- fbclid/gclid, or StabiFlow's own tracking_token's originating click.
  add column if not exists click_id text,

  -- Idempotency (durable rule #26): a provider or webhook redelivery of
  -- the same real-world event must never create a second touchpoint row.
  add column if not exists provider_event_id text,

  -- StabiFlow's own opaque campaign-entry token (see campaign_entry_tokens
  -- below) - populated when this touchpoint originated from a link/QR/
  -- button StabiFlow itself generated, not from a provider-native referral.
  add column if not exists tracking_token text,

  -- Provider event time vs. when StabiFlow actually recorded it (durable
  -- rule #27) - occurred_at already exists and defaults to now(), which is
  -- correct for StabiFlow-originated events (a webhook arriving IS the
  -- event); received_at is added for the (currently unused, future)
  -- case where a provider event's own timestamp differs from delivery time.
  add column if not exists received_at timestamptz not null default now();

alter table public.attribution_events
  alter column attribution_confidence drop default;

do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_schema = 'public' and constraint_name = 'attribution_events_confidence_check'
  ) then
    alter table public.attribution_events
      add constraint attribution_events_confidence_check
      check (attribution_confidence is null or attribution_confidence in ('exact', 'high', 'medium', 'low', 'unknown'));
  end if;
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_schema = 'public' and constraint_name = 'attribution_events_source_check'
  ) then
    alter table public.attribution_events
      add constraint attribution_events_source_check
      check (attribution_source is null or attribution_source in (
        'meta_provider', 'whatsapp_entry', 'utm', 'click_id', 'landing_page',
        'explicit_campaign_link', 'manual', 'inferred', 'organic', 'referral', 'unknown'
      ));
  end if;
end
$$;

-- Idempotency indexes (durable rule #26). Partial unique indexes, not a
-- single composite unique constraint, because either identifier alone is
-- sufficient to prove "this exact event was already recorded" and most
-- rows will only ever populate one of the two.
create unique index if not exists attribution_events_provider_event_idx
  on public.attribution_events (workspace_id, provider_event_id)
  where provider_event_id is not null;
create index if not exists attribution_events_tracking_token_idx
  on public.attribution_events (workspace_id, tracking_token)
  where tracking_token is not null;
create index if not exists attribution_events_conversation_idx
  on public.attribution_events (conversation_id, occurred_at) where conversation_id is not null;
create index if not exists attribution_events_lead_idx
  on public.attribution_events (lead_id, occurred_at) where lead_id is not null;
create index if not exists attribution_events_opportunity_idx
  on public.attribution_events (opportunity_id, occurred_at) where opportunity_id is not null;
create index if not exists attribution_events_customer_idx
  on public.attribution_events (customer_id, occurred_at) where customer_id is not null;
create index if not exists attribution_events_campaign_ref_idx
  on public.attribution_events (campaign_id, occurred_at) where campaign_id is not null;
create index if not exists attribution_events_ad_idx
  on public.attribution_events (ad_id) where ad_id is not null;

-- Workspace-consistency trigger (durable rule #28/#29): every one of the
-- 8 nullable references above must belong to the SAME workspace_id as the
-- event itself, proven from a direct service-role insert, not just RLS.
create or replace function public.attribution_events_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.campaign_id is not null and not exists (select 1 from public.ad_campaigns where id = new.campaign_id and workspace_id = new.workspace_id) then
    raise exception 'attribution_events.campaign_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.ad_set_id is not null and not exists (select 1 from public.ad_sets where id = new.ad_set_id and workspace_id = new.workspace_id) then
    raise exception 'attribution_events.ad_set_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.ad_id is not null and not exists (select 1 from public.ads where id = new.ad_id and workspace_id = new.workspace_id) then
    raise exception 'attribution_events.ad_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.creative_id is not null and not exists (select 1 from public.ad_creatives where id = new.creative_id and workspace_id = new.workspace_id) then
    raise exception 'attribution_events.creative_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.conversation_id is not null and not exists (select 1 from public.inbox_conversations where id = new.conversation_id and workspace_id = new.workspace_id) then
    raise exception 'attribution_events.conversation_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.lead_id is not null and not exists (select 1 from public.leads where id = new.lead_id and workspace_id = new.workspace_id) then
    raise exception 'attribution_events.lead_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.opportunity_id is not null and not exists (select 1 from public.opportunities where id = new.opportunity_id and workspace_id = new.workspace_id) then
    raise exception 'attribution_events.opportunity_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.customer_id is not null and not exists (select 1 from public.customers where id = new.customer_id and workspace_id = new.workspace_id) then
    raise exception 'attribution_events.customer_id must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists attribution_events_validate_workspace_trg on public.attribution_events;
create trigger attribution_events_validate_workspace_trg
  before insert or update on public.attribution_events
  for each row execute function public.attribution_events_validate_workspace();

-- Tighten RLS now that attribution.*/revenue.* permissions exist (durable
-- rule #30) - the original Phase 2 policies used the broad
-- is_workspace_member() because no finer-grained permission existed yet.
-- Nothing in the app reads/writes this table today, so tightening is safe.
drop policy if exists "attribution_events_select_member" on public.attribution_events;
create policy "attribution_events_select"
on public.attribution_events for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'attribution.view'));

drop policy if exists "attribution_events_insert_member" on public.attribution_events;
create policy "attribution_events_insert"
on public.attribution_events for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'attribution.manage'));
-- Still no update/delete policy for regular members - append-only, exactly
-- as the original table's own comment already required. Manual overrides
-- (durable rule #24) are implemented as a NEW row (attribution_method =
-- 'manual'), never an edit of history.

-- 3. campaign_entry_tokens ----------------------------------------------------
-- Future-ready scaffolding (durable rule #12/#39) for a StabiFlow-generated
-- tracking link/QR/button whose destination isn't a native Meta ad
-- referral (which already carries its own reliable ad_id/click_id - see
-- the whatsapp-webhook resolution logic). Not wired into any UI yet in
-- this phase - no website/landing-page product surface exists to consume
-- it - but the resolution shape is real: opaque token -> server-side
-- lookup -> workspace/campaign/ad/creative context, never a client-
-- supplied workspace_id.

create table if not exists public.campaign_entry_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token text not null,
  campaign_id uuid references public.ad_campaigns(id) on delete set null,
  ad_set_id uuid references public.ad_sets(id) on delete set null,
  ad_id uuid references public.ads(id) on delete set null,
  creative_id uuid references public.ad_creatives(id) on delete set null,
  destination_type text,
  label text check (label is null or length(label) <= 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create unique index if not exists campaign_entry_tokens_token_key on public.campaign_entry_tokens (token);
create index if not exists campaign_entry_tokens_workspace_idx on public.campaign_entry_tokens (workspace_id);

create or replace function public.campaign_entry_tokens_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.campaign_id is not null and not exists (select 1 from public.ad_campaigns where id = new.campaign_id and workspace_id = new.workspace_id) then
    raise exception 'campaign_entry_tokens.campaign_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.ad_set_id is not null and not exists (select 1 from public.ad_sets where id = new.ad_set_id and workspace_id = new.workspace_id) then
    raise exception 'campaign_entry_tokens.ad_set_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.ad_id is not null and not exists (select 1 from public.ads where id = new.ad_id and workspace_id = new.workspace_id) then
    raise exception 'campaign_entry_tokens.ad_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.creative_id is not null and not exists (select 1 from public.ad_creatives where id = new.creative_id and workspace_id = new.workspace_id) then
    raise exception 'campaign_entry_tokens.creative_id must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_entry_tokens_validate_workspace_trg on public.campaign_entry_tokens;
create trigger campaign_entry_tokens_validate_workspace_trg
  before insert or update on public.campaign_entry_tokens
  for each row execute function public.campaign_entry_tokens_validate_workspace();

alter table public.campaign_entry_tokens enable row level security;

drop policy if exists "campaign_entry_tokens_select" on public.campaign_entry_tokens;
create policy "campaign_entry_tokens_select"
on public.campaign_entry_tokens for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'attribution.view'));

drop policy if exists "campaign_entry_tokens_write" on public.campaign_entry_tokens;
create policy "campaign_entry_tokens_write"
on public.campaign_entry_tokens for all
to authenticated
using (public.has_workspace_permission(workspace_id, 'attribution.manage'))
with check (public.has_workspace_permission(workspace_id, 'attribution.manage'));

-- 4. revenue_events -----------------------------------------------------------
-- Deliberately minimal (durable rule #20/#23) - no invoicing/accounting.
-- Distinct from opportunities.actual_value on purpose (durable rule #21):
-- actual_value is the DEAL value as recorded when won; revenue_events are
-- the real cash events (which may be partial, staged, or adjusted) that
-- later reporting sums independently - they are never assumed equal.

create table if not exists public.revenue_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  customer_id uuid references public.customers(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,

  amount_minor bigint not null check (amount_minor <> 0), -- negative allowed: adjustment/refund event types
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  event_type text not null check (event_type in ('sale', 'payment', 'contract_value', 'adjustment', 'refund')),
  occurred_at timestamptz not null default now(),

  source text not null default 'manual', -- 'manual' today; free text so a future payment-provider integration doesn't need a schema change
  reference text check (reference is null or length(reference) <= 200),
  metadata jsonb not null default '{}'::jsonb,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint revenue_events_requires_a_target check (customer_id is not null or opportunity_id is not null or lead_id is not null)
);

create index if not exists revenue_events_workspace_idx on public.revenue_events (workspace_id, occurred_at desc);
create index if not exists revenue_events_customer_idx on public.revenue_events (customer_id) where customer_id is not null;
create index if not exists revenue_events_opportunity_idx on public.revenue_events (opportunity_id) where opportunity_id is not null;

create or replace function public.revenue_events_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is not null and not exists (select 1 from public.customers where id = new.customer_id and workspace_id = new.workspace_id) then
    raise exception 'revenue_events.customer_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.opportunity_id is not null and not exists (select 1 from public.opportunities where id = new.opportunity_id and workspace_id = new.workspace_id) then
    raise exception 'revenue_events.opportunity_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.lead_id is not null and not exists (select 1 from public.leads where id = new.lead_id and workspace_id = new.workspace_id) then
    raise exception 'revenue_events.lead_id must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists revenue_events_validate_workspace_trg on public.revenue_events;
create trigger revenue_events_validate_workspace_trg
  before insert or update on public.revenue_events
  for each row execute function public.revenue_events_validate_workspace();

alter table public.revenue_events enable row level security;

drop policy if exists "revenue_events_select" on public.revenue_events;
create policy "revenue_events_select"
on public.revenue_events for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'revenue.view'));

drop policy if exists "revenue_events_insert" on public.revenue_events;
create policy "revenue_events_insert"
on public.revenue_events for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'revenue.create'));

drop policy if exists "revenue_events_update" on public.revenue_events;
create policy "revenue_events_update"
on public.revenue_events for update
to authenticated
using (public.has_workspace_permission(workspace_id, 'revenue.edit'))
with check (public.has_workspace_permission(workspace_id, 'revenue.edit'));
-- No delete policy: revenue history is corrected with an 'adjustment'/
-- 'refund' event, never erased.

-- 5. Permissions ----------------------------------------------------------------
-- attribution.view mirrors content.view/campaign.view's broad grant
-- (marketing metadata, not customer content). attribution.manage
-- (required for manual overrides - durable rule #30) is manager-and-up,
-- matching pipeline.manage. revenue.* mirrors opportunity.*'s grant set -
-- revenue is opportunity-adjacent, owned by the same roles that close deals.

insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'attribution.view'), ('owner', 'attribution.manage'), ('owner', 'revenue.view'), ('owner', 'revenue.create'), ('owner', 'revenue.edit'),
  ('admin', 'attribution.view'), ('admin', 'attribution.manage'), ('admin', 'revenue.view'), ('admin', 'revenue.create'), ('admin', 'revenue.edit'),
  ('manager', 'attribution.view'), ('manager', 'attribution.manage'), ('manager', 'revenue.view'), ('manager', 'revenue.create'), ('manager', 'revenue.edit'),
  ('marketing', 'attribution.view'), ('marketing', 'revenue.view'),
  ('sales', 'attribution.view'), ('sales', 'revenue.view'), ('sales', 'revenue.create'), ('sales', 'revenue.edit'),
  ('support', 'attribution.view'), ('support', 'revenue.view'),
  ('viewer', 'attribution.view'), ('viewer', 'revenue.view')
on conflict (role, permission) do nothing;

-- 6. Derived first/last touch (durable rule #7/#25) ------------------------------
-- One security-definer function covering all four subject types (rather
-- than four near-duplicate views) - RLS on attribution_events itself is
-- bypassed inside (security definer), so the function re-checks
-- attribution.view explicitly before returning anything. "first/last
-- touch" is presented as ONE deterministic, storage-cheap read model, not
-- a claim that it's the only valid attribution model - the raw event rows
-- remain queryable for any future multi-touch model without a schema
-- change (durable rule #8).

create or replace function public.get_touch_summary(p_workspace_id uuid, p_target_type text, p_target_id uuid)
returns table (
  touch_kind text,
  event_id uuid,
  platform text,
  source_type text,
  source text,
  occurred_at timestamptz,
  campaign_id uuid,
  ad_id uuid,
  creative_id uuid,
  attribution_confidence text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'attribution.view') then
    return; -- empty result set, not an error - mirrors RLS's own "just see nothing" behavior
  end if;
  if p_target_type not in ('conversation', 'lead', 'opportunity', 'customer') then
    raise exception 'p_target_type must be one of conversation, lead, opportunity, customer' using errcode = '22023';
  end if;

  return query execute format(
    $q$
      (select 'first_touch', id, platform, source_type, source, occurred_at, campaign_id, ad_id, creative_id, attribution_confidence
       from public.attribution_events
       where workspace_id = $1 and %1$I = $2
       order by occurred_at asc limit 1)
      union all
      (select 'last_touch', id, platform, source_type, source, occurred_at, campaign_id, ad_id, creative_id, attribution_confidence
       from public.attribution_events
       where workspace_id = $1 and %1$I = $2
       order by occurred_at desc limit 1)
      union all
      (select 'first_paid_touch', id, platform, source_type, source, occurred_at, campaign_id, ad_id, creative_id, attribution_confidence
       from public.attribution_events
       where workspace_id = $1 and %1$I = $2 and source_type = 'paid'
       order by occurred_at asc limit 1)
      union all
      (select 'last_paid_touch', id, platform, source_type, source, occurred_at, campaign_id, ad_id, creative_id, attribution_confidence
       from public.attribution_events
       where workspace_id = $1 and %1$I = $2 and source_type = 'paid'
       order by occurred_at desc limit 1)
    $q$,
    p_target_type || '_id'
  ) using p_workspace_id, p_target_id;
end;
$$;

comment on function public.get_touch_summary(uuid, text, uuid) is
  'Returns up to 4 rows (first_touch, last_touch, first_paid_touch, last_paid_touch) for a conversation/lead/opportunity/customer - a deterministic read model over the raw attribution_events, not the only possible attribution model.';

-- 7. Campaign/creative conversion counts (durable rule #32/#34) -------------------
-- Simple, real counts derived from attribution_events links - never
-- invented. No ROAS, no revenue aggregation here (durable rule #46) - that
-- is explicitly Phase H's job once spend + revenue + attribution are all
-- independently trustworthy.

create or replace function public.get_campaign_conversion_counts(p_workspace_id uuid, p_campaign_id uuid)
returns table (conversations bigint, leads bigint, opportunities bigint, customers bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(distinct conversation_id) filter (where conversation_id is not null),
    count(distinct lead_id) filter (where lead_id is not null),
    count(distinct opportunity_id) filter (where opportunity_id is not null),
    count(distinct customer_id) filter (where customer_id is not null)
  from public.attribution_events
  where workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and public.has_workspace_permission(p_workspace_id, 'attribution.view');
$$;
