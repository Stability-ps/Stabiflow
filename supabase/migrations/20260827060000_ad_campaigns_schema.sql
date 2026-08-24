-- StabiFlow Campaigns module (Phase 6): paid Meta advertising, kept
-- deliberately distinct from the organic Content module (content_series /
-- content_scheduled_posts, Phase 5). "Campaign" was reserved for exactly
-- this concept in the Phase 5 schema migration's naming-decision comment -
-- see 20260826060000_content_module_schema.sql.
--
-- Same defense-in-depth shape as Phase 5: every table carries its own
-- workspace_id, and a BEFORE INSERT OR UPDATE trigger validates that every
-- foreign key on the row belongs to that SAME workspace_id. RLS alone only
-- proves the row's OWN workspace_id is one the caller belongs to - it says
-- nothing about whether a foreign key quietly points into a different
-- workspace. These triggers are what makes "Workspace A campaign cannot
-- reference Workspace B's ad account/page/media asset" true at the
-- database layer, immune even to a service-role/direct-SQL insert.
--
-- Builder UX simplification (documented, not an oversight): the Phase 6
-- Campaign Builder produces exactly one ad set and one ad per campaign -
-- a non-expert business owner picks a goal, an audience, a budget, and a
-- creative, not a multi-ad-set media plan. The relational model below is
-- NOT collapsed to match that UI, though: ad_campaigns / ad_sets / ads /
-- ad_creatives are separate tables with real foreign keys, exactly the
-- shape a future multi-ad-set Creative Studio expansion needs, so growing
-- past "one ad set per campaign" later is additive, not a rewrite.
--
-- Supported objectives (documented per Phase 6 instruction #6 - verified
-- against the Meta Marketing API's current (Graph API v21.0+) ODAX
-- objective model, which replaced the pre-2022 objective set):
--   OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_SALES
-- OUTCOME_LEADS and OUTCOME_APP_PROMOTION are deliberately NOT supported
-- this phase: OUTCOME_LEADS requires a Meta Lead Ads instant-form resource
-- (a new provider object type StabiFlow doesn't create, and it feeds
-- directly into the Leads module - explicitly out of scope for Phase 6 per
-- the phase brief's "do not build Leads"). OUTCOME_APP_PROMOTION has no
-- StabiFlow app destination at all. OUTCOME_SALES is implemented as a
-- traffic-to-destination objective (optimization_goal LINK_CLICKS) rather
-- than a true conversion objective, because StabiFlow has no Meta
-- Pixel/Conversions API integration yet - documented in the Phase 6
-- completion report, not silently assumed.
-- Graph API version pinned via the AD_META_GRAPH_API_VERSION edge function
-- secret (defaults to v21.0 - see supabase/functions/_shared/ad-providers/metaMarketingApi.ts).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ad_campaign_objective') then
    create type public.ad_campaign_objective as enum ('OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_SALES');
  end if;
  if not exists (select 1 from pg_type where typname = 'ad_destination_type') then
    create type public.ad_destination_type as enum ('website', 'whatsapp', 'page_profile');
  end if;
  if not exists (select 1 from pg_type where typname = 'ad_budget_type') then
    create type public.ad_budget_type as enum ('daily', 'lifetime');
  end if;
  -- Shared local workflow lifecycle across campaign / ad set / ad - see
  -- Phase 6 instruction #8 ("draft-first design"). Provider status
  -- (provider_configured_status / provider_effective_status, both raw
  -- text - Meta's own status vocabulary is not stable enough to enum) is
  -- tracked separately and may disagree with this column, e.g. a campaign
  -- can be locally 'active' while Meta's effective_status is
  -- 'PENDING_REVIEW'.
  if not exists (select 1 from pg_type where typname = 'ad_lifecycle_status') then
    create type public.ad_lifecycle_status as enum ('draft', 'ready', 'publishing', 'active', 'paused', 'completed', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'ad_creative_status') then
    create type public.ad_creative_status as enum ('draft', 'ready', 'active', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'ad_publish_operation_status') then
    create type public.ad_publish_operation_status as enum ('pending', 'in_progress', 'succeeded', 'partial', 'failed');
  end if;
end
$$;

-- ad_creatives -----------------------------------------------------------
-- Created independently of a campaign so "reuse an existing StabiFlow
-- Content asset" (instruction #11) is a first-class fact: a creative
-- always references the ORIGINAL content_media_assets row, optionally a
-- platform-specific content_platform_variants row, and never duplicates
-- the underlying file. whatsapp_number_id is a schema-only hook for a
-- future Click-to-WhatsApp destination (instruction #28) - nullable,
-- unused by any Phase 6 UI or publish path.

create table if not exists public.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  media_asset_id uuid not null references public.content_media_assets(id) on delete restrict,
  platform_variant_id uuid references public.content_platform_variants(id) on delete set null,
  headline text check (headline is null or length(headline) <= 255),
  primary_text text not null check (length(trim(primary_text)) between 1 and 2000),
  description text check (description is null or length(description) <= 255),
  cta text not null,
  destination_url text,
  whatsapp_number_id uuid references public.workspace_whatsapp_numbers(id) on delete set null,
  external_creative_id text,
  status public.ad_creative_status not null default 'draft',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_creatives_destination_shape check (
    (destination_url is not null and whatsapp_number_id is null)
    or (destination_url is null and whatsapp_number_id is not null)
    or (destination_url is null and whatsapp_number_id is null) -- page_profile destination: neither
  )
);

create index if not exists ad_creatives_workspace_idx on public.ad_creatives (workspace_id, created_at desc);
create index if not exists ad_creatives_media_asset_idx on public.ad_creatives (media_asset_id);

drop trigger if exists set_ad_creatives_updated_at on public.ad_creatives;
create trigger set_ad_creatives_updated_at before update on public.ad_creatives
  for each row execute function public.set_updated_at();

create or replace function public.ad_creatives_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.content_media_assets where id = new.media_asset_id and workspace_id = new.workspace_id) then
    raise exception 'ad_creatives.workspace_id must match its media_asset_id''s workspace' using errcode = '23514';
  end if;
  if new.platform_variant_id is not null and not exists (
    select 1 from public.content_platform_variants
    where id = new.platform_variant_id and workspace_id = new.workspace_id and media_asset_id = new.media_asset_id
  ) then
    raise exception 'ad_creatives.platform_variant_id must belong to the same workspace and media asset' using errcode = '23514';
  end if;
  if new.whatsapp_number_id is not null and not exists (
    select 1 from public.workspace_whatsapp_numbers where id = new.whatsapp_number_id and workspace_id = new.workspace_id
  ) then
    raise exception 'ad_creatives.whatsapp_number_id must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ad_creatives_validate_workspace_trg on public.ad_creatives;
create trigger ad_creatives_validate_workspace_trg
  before insert or update on public.ad_creatives
  for each row execute function public.ad_creatives_validate_workspace();

-- ad_campaigns -------------------------------------------------------------
-- Holds the full Campaign Builder draft state (audience/budget/schedule/
-- destination + a pointer at the draft creative), not just the eventual
-- Meta campaign object's fields - see the builder-UX note at the top of
-- this file for why ad_sets/ads are materialized only at publish time.

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  -- Meta account model (instruction #3): every campaign is pinned to one
  -- workspace Meta integration, one ad account, and the relevant page/IG
  -- account - never a global token, never an inferred "the one ad account".
  integration_id uuid not null references public.workspace_integrations(id) on delete restrict,
  ad_account_id uuid not null references public.workspace_meta_ad_accounts(id) on delete restrict,
  facebook_page_id uuid references public.workspace_facebook_pages(id) on delete restrict,
  instagram_account_id uuid references public.workspace_instagram_accounts(id) on delete restrict,

  name text not null check (length(trim(name)) between 1 and 200),
  objective public.ad_campaign_objective not null,
  buying_type text not null default 'AUCTION' check (buying_type = 'AUCTION'),
  destination_type public.ad_destination_type not null default 'website',

  status public.ad_lifecycle_status not null default 'draft',
  provider_configured_status text,
  provider_effective_status text,
  external_campaign_id text,

  budget_type public.ad_budget_type not null default 'daily',
  -- Minor units (cents) - see instruction #16 ("store monetary values
  -- using appropriate integer/minor-unit representation"). Never a float.
  daily_budget_minor_units bigint check (daily_budget_minor_units is null or daily_budget_minor_units > 0),
  lifetime_budget_minor_units bigint check (lifetime_budget_minor_units is null or lifetime_budget_minor_units > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),

  start_at timestamptz not null,
  end_at timestamptz,

  -- Audience basics (instruction #3/#7 step 3): kept as jsonb rather than a
  -- fixed set of columns because Meta's targeting spec is large and
  -- evolving - the shape actually used by StabiFlow's builder is documented
  -- in src/lib/adCampaigns.ts (age_min, age_max, genders, geo_countries,
  -- interests).
  audience jsonb not null default '{}'::jsonb,
  placements jsonb not null default '{"type": "automatic"}'::jsonb,

  draft_creative_id uuid references public.ad_creatives(id) on delete set null,

  -- "Promote as Campaign" foundation (instruction #12): if this campaign
  -- was started from an organic Content item, the origin is preserved -
  -- never used to auto-publish, only for provenance/UI ("started from this
  -- post").
  source_content_media_asset_id uuid references public.content_media_assets(id) on delete set null,
  source_content_series_id uuid references public.content_series(id) on delete set null,

  -- Partial-failure + idempotent-publish bookkeeping (instructions #13/#14).
  -- provider_state accumulates {campaign:{id,created_at}, ad_set:{...},
  -- ad:{...}} as each Meta object is actually created, so a retry after a
  -- partial failure resumes from the first missing step instead of
  -- re-creating (and double-spending) objects that already exist at Meta.
  provider_state jsonb not null default '{}'::jsonb,
  last_publish_error jsonb,
  last_readiness_check jsonb,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ad_campaigns_budget_shape check (
    (budget_type = 'daily' and daily_budget_minor_units is not null and lifetime_budget_minor_units is null)
    or (budget_type = 'lifetime' and lifetime_budget_minor_units is not null and daily_budget_minor_units is null)
  ),
  constraint ad_campaigns_lifetime_budget_requires_end_at check (
    budget_type <> 'lifetime' or end_at is not null
  ),
  constraint ad_campaigns_end_after_start check (end_at is null or end_at > start_at),
  constraint ad_campaigns_destination_matches_type check (
    (destination_type = 'website') -- destination_url lives on the creative
    or (destination_type = 'whatsapp')
    or (destination_type = 'page_profile')
  )
);

create index if not exists ad_campaigns_workspace_status_idx on public.ad_campaigns (workspace_id, status, created_at desc);
create index if not exists ad_campaigns_ad_account_idx on public.ad_campaigns (ad_account_id);
create index if not exists ad_campaigns_external_id_idx on public.ad_campaigns (external_campaign_id) where external_campaign_id is not null;

drop trigger if exists set_ad_campaigns_updated_at on public.ad_campaigns;
create trigger set_ad_campaigns_updated_at before update on public.ad_campaigns
  for each row execute function public.set_updated_at();

create or replace function public.ad_campaigns_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_integrations
    where id = new.integration_id and workspace_id = new.workspace_id and provider = 'meta'
  ) then
    raise exception 'ad_campaigns.integration_id must be a Meta integration belonging to the same workspace' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.workspace_meta_ad_accounts
    where id = new.ad_account_id and workspace_id = new.workspace_id and integration_id = new.integration_id
  ) then
    raise exception 'ad_campaigns.ad_account_id must belong to the same workspace and integration' using errcode = '23514';
  end if;

  if new.facebook_page_id is not null and not exists (
    select 1 from public.workspace_facebook_pages where id = new.facebook_page_id and workspace_id = new.workspace_id
  ) then
    raise exception 'ad_campaigns.facebook_page_id must belong to the same workspace' using errcode = '23514';
  end if;

  if new.instagram_account_id is not null and not exists (
    select 1 from public.workspace_instagram_accounts where id = new.instagram_account_id and workspace_id = new.workspace_id
  ) then
    raise exception 'ad_campaigns.instagram_account_id must belong to the same workspace' using errcode = '23514';
  end if;

  if new.draft_creative_id is not null and not exists (
    select 1 from public.ad_creatives where id = new.draft_creative_id and workspace_id = new.workspace_id
  ) then
    raise exception 'ad_campaigns.draft_creative_id must belong to the same workspace' using errcode = '23514';
  end if;

  if new.source_content_media_asset_id is not null and not exists (
    select 1 from public.content_media_assets where id = new.source_content_media_asset_id and workspace_id = new.workspace_id
  ) then
    raise exception 'ad_campaigns.source_content_media_asset_id must belong to the same workspace' using errcode = '23514';
  end if;

  if new.source_content_series_id is not null and not exists (
    select 1 from public.content_series where id = new.source_content_series_id and workspace_id = new.workspace_id
  ) then
    raise exception 'ad_campaigns.source_content_series_id must belong to the same workspace' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists ad_campaigns_validate_workspace_trg on public.ad_campaigns;
create trigger ad_campaigns_validate_workspace_trg
  before insert or update on public.ad_campaigns
  for each row execute function public.ad_campaigns_validate_workspace();

-- ad_sets --------------------------------------------------------------------
-- Materialized by the publish edge function, one per campaign in Phase 6
-- (see builder-UX note above) - the table itself places no such limit.

create table if not exists public.ad_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,

  name text not null check (length(trim(name)) between 1 and 200),
  external_adset_id text,
  status public.ad_lifecycle_status not null default 'draft',
  provider_configured_status text,
  provider_effective_status text,

  optimization_goal text not null,
  billing_event text not null,
  targeting jsonb not null default '{}'::jsonb,
  placements jsonb not null default '{"type": "automatic"}'::jsonb,

  start_at timestamptz not null,
  end_at timestamptz,
  -- ABO (ad-set-level budget) override - nullable because Phase 6's
  -- builder always uses CBO (campaign-level budget, see ad_campaigns
  -- budget_type above). Present so an ABO campaign can be represented
  -- without a schema change once that path is built.
  daily_budget_minor_units bigint check (daily_budget_minor_units is null or daily_budget_minor_units > 0),
  lifetime_budget_minor_units bigint check (lifetime_budget_minor_units is null or lifetime_budget_minor_units > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_sets_workspace_idx on public.ad_sets (workspace_id);
create index if not exists ad_sets_campaign_idx on public.ad_sets (campaign_id);

drop trigger if exists set_ad_sets_updated_at on public.ad_sets;
create trigger set_ad_sets_updated_at before update on public.ad_sets
  for each row execute function public.set_updated_at();

create or replace function public.ad_sets_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.ad_campaigns where id = new.campaign_id and workspace_id = new.workspace_id) then
    raise exception 'ad_sets.workspace_id must match its campaign_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ad_sets_validate_workspace_trg on public.ad_sets;
create trigger ad_sets_validate_workspace_trg
  before insert or update on public.ad_sets
  for each row execute function public.ad_sets_validate_workspace();

-- ads --------------------------------------------------------------------

create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_set_id uuid not null references public.ad_sets(id) on delete cascade,
  creative_id uuid not null references public.ad_creatives(id) on delete restrict,

  name text not null check (length(trim(name)) between 1 and 200),
  external_ad_id text,
  status public.ad_lifecycle_status not null default 'draft',
  provider_configured_status text,
  provider_effective_status text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ads_workspace_idx on public.ads (workspace_id);
create index if not exists ads_ad_set_idx on public.ads (ad_set_id);

drop trigger if exists set_ads_updated_at on public.ads;
create trigger set_ads_updated_at before update on public.ads
  for each row execute function public.set_updated_at();

create or replace function public.ads_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.ad_sets where id = new.ad_set_id and workspace_id = new.workspace_id) then
    raise exception 'ads.workspace_id must match its ad_set_id''s workspace' using errcode = '23514';
  end if;
  if not exists (select 1 from public.ad_creatives where id = new.creative_id and workspace_id = new.workspace_id) then
    raise exception 'ads.workspace_id must match its creative_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ads_validate_workspace_trg on public.ads;
create trigger ads_validate_workspace_trg
  before insert or update on public.ads
  for each row execute function public.ads_validate_workspace();

-- ad_publish_operations ----------------------------------------------------
-- One row per publish ATTEMPT (instruction #14 - idempotency). A client
-- supplies idempotency_key (a uuid minted once, at the moment the Publish
-- confirmation is shown); a retry of the exact same click/request reuses
-- the same key and this table's unique constraint makes a second Meta
-- campaign creation impossible - see _shared/adPublishExecution.ts.

create table if not exists public.ad_publish_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  idempotency_key text not null,
  status public.ad_publish_operation_status not null default 'pending',
  requested_by uuid references public.profiles(id) on delete set null,
  -- Ordered list of {step, status, external_id, error} - see
  -- _shared/adPublishExecution.ts. Gives partial-failure visibility
  -- ("Campaign created at Meta, Ad creation failed") without having to
  -- reconstruct it from provider_state alone.
  steps jsonb not null default '[]'::jsonb,
  error jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists ad_publish_operations_idempotency_key_key on public.ad_publish_operations (idempotency_key);
create index if not exists ad_publish_operations_campaign_idx on public.ad_publish_operations (campaign_id, created_at desc);
create index if not exists ad_publish_operations_workspace_idx on public.ad_publish_operations (workspace_id);

create or replace function public.ad_publish_operations_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.ad_campaigns where id = new.campaign_id and workspace_id = new.workspace_id) then
    raise exception 'ad_publish_operations.workspace_id must match its campaign_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ad_publish_operations_validate_workspace_trg on public.ad_publish_operations;
create trigger ad_publish_operations_validate_workspace_trg
  before insert or update on public.ad_publish_operations
  for each row execute function public.ad_publish_operations_validate_workspace();

-- ad_campaign_metrics --------------------------------------------------------
-- Provider metric snapshots (instruction #18). Campaign-level rows have
-- ad_set_id/ad_id null; finer-grained snapshots are additive. Upserted by
-- the metrics-sync edge function using the expression unique index below
-- (coalesce, since a plain UNIQUE constraint treats NULL as distinct every
-- time and would allow duplicate campaign-level rows for the same date).

create table if not exists public.ad_campaign_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  ad_set_id uuid references public.ad_sets(id) on delete cascade,
  ad_id uuid references public.ads(id) on delete cascade,

  date_start date not null,
  date_stop date not null,

  spend_minor_units bigint not null default 0 check (spend_minor_units >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  impressions bigint not null default 0 check (impressions >= 0),
  reach bigint not null default 0 check (reach >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  ctr numeric(9, 6),
  cpc_minor_units bigint,
  cpm_minor_units bigint,
  frequency numeric(9, 4),
  results integer,
  cost_per_result_minor_units bigint,

  raw_provider_response jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists ad_campaign_metrics_unique_idx on public.ad_campaign_metrics (
  campaign_id,
  coalesce(ad_set_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(ad_id, '00000000-0000-0000-0000-000000000000'::uuid),
  date_start,
  date_stop
);
create index if not exists ad_campaign_metrics_workspace_idx on public.ad_campaign_metrics (workspace_id, date_start desc);
create index if not exists ad_campaign_metrics_campaign_idx on public.ad_campaign_metrics (campaign_id, date_start desc);

create or replace function public.ad_campaign_metrics_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.ad_campaigns where id = new.campaign_id and workspace_id = new.workspace_id) then
    raise exception 'ad_campaign_metrics.workspace_id must match its campaign_id''s workspace' using errcode = '23514';
  end if;
  if new.ad_set_id is not null and not exists (
    select 1 from public.ad_sets where id = new.ad_set_id and workspace_id = new.workspace_id and campaign_id = new.campaign_id
  ) then
    raise exception 'ad_campaign_metrics.ad_set_id must belong to the same workspace and campaign' using errcode = '23514';
  end if;
  if new.ad_id is not null and not exists (
    select 1 from public.ads where id = new.ad_id and workspace_id = new.workspace_id
  ) then
    raise exception 'ad_campaign_metrics.ad_id must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ad_campaign_metrics_validate_workspace_trg on public.ad_campaign_metrics;
create trigger ad_campaign_metrics_validate_workspace_trg
  before insert or update on public.ad_campaign_metrics
  for each row execute function public.ad_campaign_metrics_validate_workspace();
