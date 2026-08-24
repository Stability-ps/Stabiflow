-- StabiFlow Content module: media library, series-based and ad-hoc post
-- scheduling, publish attempt history. Ported from Acapolite's proven
-- social-scheduling engine (supabase/migrations/20260822170000_...,
-- 20260823120000_...) and made workspace-scoped from the ground up.
--
-- Naming decision (documented per Phase 5 instructions before renaming):
--   social_accounts       -> NOT recreated. StabiFlow already has
--                            workspace_facebook_pages / workspace_instagram_accounts
--                            (20260824060400_workspace_integrations.sql) as the
--                            workspace-scoped, multi-resource-per-workspace
--                            equivalent. Reusing them satisfies "multiple
--                            Facebook Pages / Instagram accounts per
--                            workspace" without a duplicate table.
--   social_campaigns      -> content_series. "Campaign" is reserved for the
--                            future Meta Ads Campaigns concept (StabiFlow's
--                            "Campaigns" nav item, a distinct later phase);
--                            keeping that word here would collide with it.
--                            What this table actually represents - a group
--                            of posts sharing a recurring posting cadence -
--                            is a content *series*, not an ad spend campaign.
--   social_campaign_items          -> content_series_items
--   social_campaign_excluded_dates -> content_series_excluded_dates
--   social_scheduled_posts         -> content_scheduled_posts
--   social_publish_attempts        -> content_publish_attempts
--   social_media_assets            -> content_media_assets
--   social_platform_variants       -> content_platform_variants
--   (social_scheduler_settings is handled in the next migration file)
--
-- Every table below carries its own workspace_id (denormalized, matching
-- the existing workspace_facebook_pages/workspace_instagram_accounts
-- convention rather than relying on joins), and a BEFORE INSERT OR UPDATE
-- trigger validates that every foreign key on the row actually belongs to
-- that SAME workspace_id. This is the defense-in-depth control that makes
-- "workspace A's scheduled post cannot resolve workspace B's social
-- account/media asset" true at the database layer, not just via RLS -
-- RLS alone only proves the row's OWN workspace_id is one the caller
-- belongs to; it says nothing about whether the row's foreign keys point
-- into a different workspace entirely.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'content_platform') then
    create type public.content_platform as enum ('facebook', 'instagram', 'linkedin');
  end if;
  if not exists (select 1 from pg_type where typname = 'content_asset_status') then
    create type public.content_asset_status as enum ('active', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'content_series_status') then
    create type public.content_series_status as enum ('draft', 'approved', 'active', 'paused', 'completed', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'content_post_status') then
    create type public.content_post_status as enum ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled', 'skipped');
  end if;
  if not exists (select 1 from pg_type where typname = 'content_publish_attempt_status') then
    create type public.content_publish_attempt_status as enum ('success', 'temporary_failure', 'permanent_failure');
  end if;
end
$$;

-- content_media_assets ------------------------------------------------------

create table if not exists public.content_media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  default_caption text,
  storage_path text not null,
  mime_type text not null,
  width_px integer not null check (width_px > 0),
  height_px integer not null check (height_px > 0),
  aspect_ratio numeric(6, 3) not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  checksum_sha256 text not null,
  status public.content_asset_status not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_media_assets_workspace_status_idx
  on public.content_media_assets (workspace_id, status, created_at desc);

-- Duplicate-upload detection: "does this workspace already have a file with
-- these exact bytes" is a lookup by (workspace_id, checksum_sha256) done
-- before every upload - see contentMediaAssets.ts findDuplicateAsset().
create index if not exists content_media_assets_workspace_checksum_idx
  on public.content_media_assets (workspace_id, checksum_sha256);

drop trigger if exists set_content_media_assets_updated_at on public.content_media_assets;
create trigger set_content_media_assets_updated_at before update on public.content_media_assets
  for each row execute function public.set_updated_at();

-- content_platform_variants --------------------------------------------------

create table if not exists public.content_platform_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  media_asset_id uuid not null references public.content_media_assets(id) on delete cascade,
  platform public.content_platform not null,
  storage_path text not null,
  width_px integer not null check (width_px > 0),
  height_px integer not null check (height_px > 0),
  aspect_ratio numeric(6, 3) not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  transformation_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists content_platform_variants_asset_platform_key
  on public.content_platform_variants (media_asset_id, platform);
create index if not exists content_platform_variants_workspace_idx
  on public.content_platform_variants (workspace_id);

create or replace function public.content_platform_variants_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.content_media_assets
    where id = new.media_asset_id and workspace_id = new.workspace_id
  ) then
    raise exception 'content_platform_variants.workspace_id must match its media_asset_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists content_platform_variants_validate_workspace_trg on public.content_platform_variants;
create trigger content_platform_variants_validate_workspace_trg
  before insert or update on public.content_platform_variants
  for each row execute function public.content_platform_variants_validate_workspace();

-- content_series --------------------------------------------------------------

create table if not exists public.content_series (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  description text,
  status public.content_series_status not null default 'draft',
  start_at timestamptz not null,
  interval_days integer not null default 3 check (interval_days > 0),
  target_platforms public.content_platform[] not null default '{}'::public.content_platform[],
  default_caption_template text,
  default_hashtags text[] not null default '{}'::text[],
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  activated_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No per-series timezone column: Acapolite defaulted every campaign to a
-- hardcoded 'Africa/Johannesburg'. StabiFlow already has a real per-workspace
-- timezone (workspace_settings.timezone, set at workspace creation) - every
-- schedule computation below reads from there instead, so there is no way
-- for a series to silently drift onto the wrong zone.

create index if not exists content_series_workspace_status_idx
  on public.content_series (workspace_id, status, created_at desc);

drop trigger if exists set_content_series_updated_at on public.content_series;
create trigger set_content_series_updated_at before update on public.content_series
  for each row execute function public.set_updated_at();

-- content_series_items -------------------------------------------------------

create table if not exists public.content_series_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  series_id uuid not null references public.content_series(id) on delete cascade,
  media_asset_id uuid not null references public.content_media_assets(id) on delete restrict,
  position integer not null check (position >= 0),
  caption_override text,
  hashtags_override text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists content_series_items_series_position_key
  on public.content_series_items (series_id, position);

drop trigger if exists set_content_series_items_updated_at on public.content_series_items;
create trigger set_content_series_items_updated_at before update on public.content_series_items
  for each row execute function public.set_updated_at();

create or replace function public.content_series_items_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.content_series where id = new.series_id and workspace_id = new.workspace_id) then
    raise exception 'content_series_items.workspace_id must match its series_id''s workspace' using errcode = '23514';
  end if;
  if not exists (select 1 from public.content_media_assets where id = new.media_asset_id and workspace_id = new.workspace_id) then
    raise exception 'content_series_items.workspace_id must match its media_asset_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists content_series_items_validate_workspace_trg on public.content_series_items;
create trigger content_series_items_validate_workspace_trg
  before insert or update on public.content_series_items
  for each row execute function public.content_series_items_validate_workspace();

-- content_series_excluded_dates -----------------------------------------------

create table if not exists public.content_series_excluded_dates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  series_id uuid not null references public.content_series(id) on delete cascade,
  excluded_date date not null,
  reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists content_series_excluded_dates_series_date_key
  on public.content_series_excluded_dates (series_id, excluded_date);

create or replace function public.content_series_excluded_dates_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.content_series where id = new.series_id and workspace_id = new.workspace_id) then
    raise exception 'content_series_excluded_dates.workspace_id must match its series_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists content_series_excluded_dates_validate_workspace_trg on public.content_series_excluded_dates;
create trigger content_series_excluded_dates_validate_workspace_trg
  before insert or update on public.content_series_excluded_dates
  for each row execute function public.content_series_excluded_dates_validate_workspace();

-- content_scheduled_posts ------------------------------------------------------
-- series_id is NULLABLE: the primary Phase 5 creation flow is a single
-- ad-hoc post (choose destination, media, caption, time - no series
-- required). content_series exists for the optional recurring-cadence
-- power-user path, reusing the same DST-safe schedule engine.
--
-- facebook_page_id / instagram_account_id reference StabiFlow's existing
-- workspace-scoped resource tables directly (see naming decision above) -
-- exactly one of them is set, matching target_platform.

create table if not exists public.content_scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  series_id uuid references public.content_series(id) on delete cascade,
  series_item_id uuid references public.content_series_items(id) on delete set null,
  media_asset_id uuid not null references public.content_media_assets(id) on delete restrict,
  platform_variant_id uuid references public.content_platform_variants(id) on delete set null,
  target_platform public.content_platform not null,
  facebook_page_id uuid references public.workspace_facebook_pages(id) on delete restrict,
  instagram_account_id uuid references public.workspace_instagram_accounts(id) on delete restrict,
  scheduled_at timestamptz not null,
  next_retry_at timestamptz,
  caption text not null,
  hashtags text[] not null default '{}'::text[],
  status public.content_post_status not null default 'scheduled',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  published_at timestamptz,
  provider_post_id text,
  provider_permalink text,
  failure_code text,
  failure_message text,
  idempotency_key text not null,
  claimed_at timestamptz,
  claimed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_scheduled_posts_target_matches_platform check (
    (target_platform = 'facebook' and facebook_page_id is not null and instagram_account_id is null)
    or (target_platform = 'instagram' and instagram_account_id is not null and facebook_page_id is null)
    or (target_platform = 'linkedin' and facebook_page_id is null and instagram_account_id is null)
  )
);

create unique index if not exists content_scheduled_posts_idempotency_key_key
  on public.content_scheduled_posts (idempotency_key);
create index if not exists content_scheduled_posts_due_idx
  on public.content_scheduled_posts (status, scheduled_at)
  where status = 'scheduled';
create index if not exists content_scheduled_posts_workspace_idx
  on public.content_scheduled_posts (workspace_id, scheduled_at);
create index if not exists content_scheduled_posts_series_idx
  on public.content_scheduled_posts (series_id, scheduled_at)
  where series_id is not null;
create index if not exists content_scheduled_posts_platform_variant_idx
  on public.content_scheduled_posts (platform_variant_id)
  where platform_variant_id is not null;

drop trigger if exists set_content_scheduled_posts_updated_at on public.content_scheduled_posts;
create trigger set_content_scheduled_posts_updated_at before update on public.content_scheduled_posts
  for each row execute function public.set_updated_at();

-- The core cross-tenant-reference guard (Phase 5 test requirement:
-- "Workspace A scheduled post cannot resolve Workspace B social account" /
-- "...cannot resolve Workspace B provider token" starts here - a post whose
-- facebook_page_id/instagram_account_id belongs to a different workspace
-- than the post itself can never be inserted or updated into that shape).
create or replace function public.content_scheduled_posts_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.content_media_assets where id = new.media_asset_id and workspace_id = new.workspace_id) then
    raise exception 'content_scheduled_posts.workspace_id must match its media_asset_id''s workspace' using errcode = '23514';
  end if;

  if new.platform_variant_id is not null and not exists (
    select 1 from public.content_platform_variants
    where id = new.platform_variant_id and workspace_id = new.workspace_id and media_asset_id = new.media_asset_id
  ) then
    raise exception 'content_scheduled_posts.platform_variant_id must belong to the same workspace and media asset' using errcode = '23514';
  end if;

  if new.series_id is not null and not exists (
    select 1 from public.content_series where id = new.series_id and workspace_id = new.workspace_id
  ) then
    raise exception 'content_scheduled_posts.workspace_id must match its series_id''s workspace' using errcode = '23514';
  end if;

  if new.series_item_id is not null and not exists (
    select 1 from public.content_series_items where id = new.series_item_id and workspace_id = new.workspace_id
  ) then
    raise exception 'content_scheduled_posts.workspace_id must match its series_item_id''s workspace' using errcode = '23514';
  end if;

  if new.facebook_page_id is not null and not exists (
    select 1 from public.workspace_facebook_pages where id = new.facebook_page_id and workspace_id = new.workspace_id
  ) then
    raise exception 'content_scheduled_posts.facebook_page_id must belong to the same workspace' using errcode = '23514';
  end if;

  if new.instagram_account_id is not null and not exists (
    select 1 from public.workspace_instagram_accounts where id = new.instagram_account_id and workspace_id = new.workspace_id
  ) then
    raise exception 'content_scheduled_posts.instagram_account_id must belong to the same workspace' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists content_scheduled_posts_validate_workspace_trg on public.content_scheduled_posts;
create trigger content_scheduled_posts_validate_workspace_trg
  before insert or update on public.content_scheduled_posts
  for each row execute function public.content_scheduled_posts_validate_workspace();

-- content_publish_attempts ------------------------------------------------------

create table if not exists public.content_publish_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scheduled_post_id uuid not null references public.content_scheduled_posts(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status public.content_publish_attempt_status not null,
  provider_response jsonb,
  error_code text,
  error_message text,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists content_publish_attempts_post_idx
  on public.content_publish_attempts (scheduled_post_id, attempt_number);
create index if not exists content_publish_attempts_workspace_idx
  on public.content_publish_attempts (workspace_id);

create or replace function public.content_publish_attempts_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.content_scheduled_posts
    where id = new.scheduled_post_id and workspace_id = new.workspace_id
  ) then
    raise exception 'content_publish_attempts.workspace_id must match its scheduled_post_id''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists content_publish_attempts_validate_workspace_trg on public.content_publish_attempts;
create trigger content_publish_attempts_validate_workspace_trg
  before insert or update on public.content_publish_attempts
  for each row execute function public.content_publish_attempts_validate_workspace();

-- RLS ---------------------------------------------------------------------

alter table public.content_media_assets enable row level security;
alter table public.content_platform_variants enable row level security;
alter table public.content_series enable row level security;
alter table public.content_series_items enable row level security;
alter table public.content_series_excluded_dates enable row level security;
alter table public.content_scheduled_posts enable row level security;
alter table public.content_publish_attempts enable row level security;

-- content_media_assets: view/upload/delete are the exact three media.*
-- permissions from the Phase 5 brief - see the permissions seed migration.
drop policy if exists "content_media_assets_select" on public.content_media_assets;
create policy "content_media_assets_select"
on public.content_media_assets for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'media.view'));

drop policy if exists "content_media_assets_insert" on public.content_media_assets;
create policy "content_media_assets_insert"
on public.content_media_assets for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'media.upload'));

drop policy if exists "content_media_assets_update" on public.content_media_assets;
create policy "content_media_assets_update"
on public.content_media_assets for update
to authenticated
using (public.has_workspace_permission(workspace_id, 'media.upload'))
with check (public.has_workspace_permission(workspace_id, 'media.upload'));

drop policy if exists "content_media_assets_delete" on public.content_media_assets;
create policy "content_media_assets_delete"
on public.content_media_assets for delete
to authenticated
using (public.has_workspace_permission(workspace_id, 'media.delete'));

-- content_platform_variants: generated server-side (content-generate-variants,
-- running as the caller), never hand-authored - same media.* gating as the
-- asset they're derived from.
drop policy if exists "content_platform_variants_select" on public.content_platform_variants;
create policy "content_platform_variants_select"
on public.content_platform_variants for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'media.view'));

drop policy if exists "content_platform_variants_write" on public.content_platform_variants;
create policy "content_platform_variants_write"
on public.content_platform_variants for all
to authenticated
using (public.has_workspace_permission(workspace_id, 'media.upload'))
with check (public.has_workspace_permission(workspace_id, 'media.upload'));

-- content_series / items / excluded_dates: content.view / content.create /
-- content.edit / content.delete.
drop policy if exists "content_series_select" on public.content_series;
create policy "content_series_select"
on public.content_series for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.view'));

drop policy if exists "content_series_insert" on public.content_series;
create policy "content_series_insert"
on public.content_series for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'content.create'));

drop policy if exists "content_series_update" on public.content_series;
create policy "content_series_update"
on public.content_series for update
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.edit'))
with check (public.has_workspace_permission(workspace_id, 'content.edit'));

drop policy if exists "content_series_delete" on public.content_series;
create policy "content_series_delete"
on public.content_series for delete
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.delete'));

do $$
declare
  t text;
begin
  foreach t in array array['content_series_items', 'content_series_excluded_dates']
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_workspace_permission(workspace_id, ''content.view''));',
      t || '_select', t
    );

    execute format('drop policy if exists %I on public.%I;', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_workspace_permission(workspace_id, ''content.create''));',
      t || '_insert', t
    );

    execute format('drop policy if exists %I on public.%I;', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_workspace_permission(workspace_id, ''content.edit'')) with check (public.has_workspace_permission(workspace_id, ''content.edit''));',
      t || '_update', t
    );

    execute format('drop policy if exists %I on public.%I;', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_workspace_permission(workspace_id, ''content.delete''));',
      t || '_delete', t
    );
  end loop;
end
$$;

-- content_scheduled_posts: update is deliberately gated by (content.edit OR
-- content.publish) in one policy - the real "who can trigger a Meta API
-- call" boundary is enforced by content-publish-now re-checking
-- content.publish itself before it ever claims a row, not by RLS alone;
-- RLS's job here is the tenant boundary plus "some legitimate content
-- permission", not per-column authorization.
drop policy if exists "content_scheduled_posts_select" on public.content_scheduled_posts;
create policy "content_scheduled_posts_select"
on public.content_scheduled_posts for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.view'));

drop policy if exists "content_scheduled_posts_insert" on public.content_scheduled_posts;
create policy "content_scheduled_posts_insert"
on public.content_scheduled_posts for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'content.create'));

drop policy if exists "content_scheduled_posts_update" on public.content_scheduled_posts;
create policy "content_scheduled_posts_update"
on public.content_scheduled_posts for update
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.edit') or public.has_workspace_permission(workspace_id, 'content.publish'))
with check (public.has_workspace_permission(workspace_id, 'content.edit') or public.has_workspace_permission(workspace_id, 'content.publish'));

drop policy if exists "content_scheduled_posts_delete" on public.content_scheduled_posts;
create policy "content_scheduled_posts_delete"
on public.content_scheduled_posts for delete
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.delete'));

-- content_publish_attempts: immutable audit trail - select + insert only
-- (insert happens as the authenticated caller for "Publish now"; the cron
-- worker uses the service role key, which bypasses RLS entirely).
drop policy if exists "content_publish_attempts_select" on public.content_publish_attempts;
create policy "content_publish_attempts_select"
on public.content_publish_attempts for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.view'));

drop policy if exists "content_publish_attempts_insert" on public.content_publish_attempts;
create policy "content_publish_attempts_insert"
on public.content_publish_attempts for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'content.publish'));
