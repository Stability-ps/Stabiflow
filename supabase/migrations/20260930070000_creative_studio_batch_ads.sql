-- Creative Studio: batch image ad generation.
--
-- Extends the EXISTING Creative Studio (copy generation only) into a
-- brief -> concepts -> AI background visual -> deterministic StabiFlow ad
-- rendering -> multi-size variants -> review gallery pipeline.
--
-- Design decisions:
--  * The AI image layer generates the VISUAL/BACKGROUND ONLY. Every final
--    advert is composited deterministically by StabiFlow from stored text
--    (headline/body/CTA/contact/price/disclaimer) so the exact commercial
--    wording is never at the mercy of an image model. Text columns on
--    creative_studio_creatives are the single source of truth for what
--    the renderer draws.
--  * Batch economics: one AI image call per unique visual concept, NOT
--    per finished creative. N concepts x M layouts x K sizes final ads
--    but only N image-generation calls (see MAX_* caps enforced in the
--    edge functions and the row-count guard trigger below).
--  * Storage + isolation reuse the Phase 5 content module wholesale:
--    generated visuals and rendered ads both land in the private
--    `content-media` bucket under `{workspace_id}/creative-studio/...`
--    and are registered as ordinary content_media_assets rows, so RLS,
--    signed URLs, the Media Library and the existing campaign creative
--    picker all work with zero new plumbing.
--  * Permissions reuse the existing content taxonomy: `content.view` to
--    see a batch/gallery, `content.create` for every write. No new
--    permission names (instruction #23).

-- ---------------------------------------------------------------------------
-- workspace_settings: brand-kit fields required by the renderer.
-- Business name (workspaces.name), logo (workspace_settings.logo_path),
-- website / contact_email / contact_phone / currency / industry already
-- exist from 20260828060000 and are reused as-is - only the genuinely
-- missing rendering inputs are added here.
-- ---------------------------------------------------------------------------
alter table public.workspace_settings
  add column if not exists brand_primary_color text
    check (brand_primary_color is null or brand_primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists brand_accent_color text
    check (brand_accent_color is null or brand_accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists brand_cta_text_color text
    check (brand_cta_text_color is null or brand_cta_text_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists ad_footer_disclaimer text
    check (ad_footer_disclaimer is null or length(ad_footer_disclaimer) <= 300);

comment on column public.workspace_settings.brand_primary_color is
  'Creative Studio ad renderer: primary brand colour (#RRGGBB). NULL -> renderer falls back to a neutral.';
comment on column public.workspace_settings.brand_accent_color is
  'Creative Studio ad renderer: accent/secondary colour used for the CTA button fill.';
comment on column public.workspace_settings.brand_cta_text_color is
  'Creative Studio ad renderer: optional explicit CTA label colour. NULL -> renderer picks black/white by contrast.';
comment on column public.workspace_settings.ad_footer_disclaimer is
  'Creative Studio ad renderer: optional default footer/legal disclaimer line.';

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'creative_studio_batch_status') then
    create type public.creative_studio_batch_status as enum ('draft', 'generating', 'ready', 'partial', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'creative_studio_visual_status') then
    create type public.creative_studio_visual_status as enum ('pending', 'generating', 'ready', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'creative_studio_visual_source') then
    create type public.creative_studio_visual_source as enum ('ai', 'media_library');
  end if;
  if not exists (select 1 from pg_type where typname = 'creative_studio_creative_status') then
    create type public.creative_studio_creative_status as enum ('rendering', 'ready', 'approved', 'rejected', 'failed');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- creative_studio_batches - one row per "Generate creatives" run.
-- ---------------------------------------------------------------------------
create table if not exists public.creative_studio_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status public.creative_studio_batch_status not null default 'draft',
  -- Brief snapshot (mirrors the existing copy-generation inputs so the
  -- user never re-enters the brief for the visual stage).
  business_context text not null check (length(trim(business_context)) between 1 and 1000),
  audience text check (audience is null or length(audience) <= 300),
  tone text check (tone is null or length(tone) <= 100),
  source_media_asset_id uuid references public.content_media_assets(id) on delete set null,
  -- Chosen render matrix. Validated in the edge layer against the fixed
  -- vocab (split/full_bleed/bold_statement/professional_card and
  -- 1080x1080/1080x1350/1080x1920); kept as text[] here for forward room.
  layouts text[] not null default '{}',
  sizes text[] not null default '{}',
  error_detail text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creative_studio_batches_workspace_idx
  on public.creative_studio_batches (workspace_id, created_at desc);

drop trigger if exists set_creative_studio_batches_updated_at on public.creative_studio_batches;
create trigger set_creative_studio_batches_updated_at
  before update on public.creative_studio_batches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- creative_studio_concepts - the structured concept (one AI visual each).
-- ---------------------------------------------------------------------------
create table if not exists public.creative_studio_concepts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.creative_studio_batches(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sort_order integer not null default 0,
  concept_name text not null check (length(trim(concept_name)) between 1 and 160),
  headline text not null check (length(trim(headline)) between 1 and 120),
  supporting_text text not null check (length(supporting_text) between 1 and 400),
  cta text not null check (length(trim(cta)) between 1 and 40),
  -- visual_prompt ALWAYS already carries the mandatory no-text/no-logo/
  -- no-watermark negative-prompt rule (appended server-side before insert).
  visual_prompt text not null check (length(trim(visual_prompt)) between 1 and 2000),
  layout_style text check (layout_style is null or length(layout_style) <= 60),
  visual_notes text check (visual_notes is null or length(visual_notes) <= 600),
  visual_source public.creative_studio_visual_source not null default 'ai',
  visual_status public.creative_studio_visual_status not null default 'pending',
  visual_error text,
  -- The background source: an AI-generated asset OR a Media Library image
  -- the user attached (instruction #4 - ads without paying for AI images).
  visual_media_asset_id uuid references public.content_media_assets(id) on delete set null,
  -- Idempotency claim token: set atomically when a worker moves the row
  -- pending/failed -> generating, so a double-clicked "Generate visuals"
  -- can never start a second image-generation job for the same concept.
  visual_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creative_studio_concepts_batch_idx
  on public.creative_studio_concepts (batch_id, sort_order);
create index if not exists creative_studio_concepts_workspace_idx
  on public.creative_studio_concepts (workspace_id, created_at desc);

drop trigger if exists set_creative_studio_concepts_updated_at on public.creative_studio_concepts;
create trigger set_creative_studio_concepts_updated_at
  before update on public.creative_studio_concepts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- creative_studio_creatives - one row per final rendered advert.
-- `id` IS the stable internal creative_id kept for future creative-level
-- attribution (creative -> ad -> conversation -> lead -> revenue).
-- ---------------------------------------------------------------------------
create table if not exists public.creative_studio_creatives (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.creative_studio_batches(id) on delete cascade,
  concept_id uuid not null references public.creative_studio_concepts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  layout text not null,
  size text not null,
  width_px integer not null check (width_px > 0),
  height_px integer not null check (height_px > 0),
  -- Exact commercial text - the renderer's single source of truth. Copied
  -- from the concept at plan time, then independently editable ("Edit
  -- copy" -> re-render, never a new image call).
  headline text not null check (length(trim(headline)) between 1 and 200),
  body_text text not null check (length(body_text) between 1 and 600),
  cta text not null check (length(trim(cta)) between 1 and 60),
  contact_text text check (contact_text is null or length(contact_text) <= 160),
  price_text text check (price_text is null or length(price_text) <= 60),
  disclaimer_text text check (disclaimer_text is null or length(disclaimer_text) <= 300),
  status public.creative_studio_creative_status not null default 'rendering',
  render_error text,
  overflow_warning boolean not null default false,
  -- The rendered PNG registered as an ordinary reusable content asset -
  -- powers Download and "Use in Campaign" through the existing picker.
  rendered_media_asset_id uuid references public.content_media_assets(id) on delete set null,
  storage_path text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One creative per (concept, layout, size): the idempotent re-render /
  -- "one background -> many outputs" target.
  constraint creative_studio_creatives_unique_combo unique (batch_id, concept_id, layout, size)
);

create index if not exists creative_studio_creatives_batch_idx
  on public.creative_studio_creatives (batch_id, created_at desc);
create index if not exists creative_studio_creatives_concept_idx
  on public.creative_studio_creatives (concept_id);
create index if not exists creative_studio_creatives_workspace_idx
  on public.creative_studio_creatives (workspace_id, created_at desc);

drop trigger if exists set_creative_studio_creatives_updated_at on public.creative_studio_creatives;
create trigger set_creative_studio_creatives_updated_at
  before update on public.creative_studio_creatives
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Workspace-consistency triggers. Mirror ad_creatives_validate_workspace:
-- every cross-row reference must stay inside one workspace, enforced in
-- the DB regardless of which client or service role writes the row. This
-- is what makes the cross-workspace attach/regenerate/sign tests fail
-- closed even if an edge function had a bug.
-- ---------------------------------------------------------------------------
create or replace function public.creative_studio_concepts_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.creative_studio_batches
    where id = new.batch_id and workspace_id = new.workspace_id
  ) then
    raise exception 'creative_studio_concepts.workspace_id must match its batch''s workspace' using errcode = '23514';
  end if;
  if new.visual_media_asset_id is not null and not exists (
    select 1 from public.content_media_assets
    where id = new.visual_media_asset_id and workspace_id = new.workspace_id
  ) then
    raise exception 'creative_studio_concepts.visual_media_asset_id must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists creative_studio_concepts_validate_workspace_trg on public.creative_studio_concepts;
create trigger creative_studio_concepts_validate_workspace_trg
  before insert or update on public.creative_studio_concepts
  for each row execute function public.creative_studio_concepts_validate_workspace();

create or replace function public.creative_studio_creatives_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_concept_count integer;
begin
  if not exists (
    select 1 from public.creative_studio_batches
    where id = new.batch_id and workspace_id = new.workspace_id
  ) then
    raise exception 'creative_studio_creatives.workspace_id must match its batch''s workspace' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.creative_studio_concepts
    where id = new.concept_id and batch_id = new.batch_id and workspace_id = new.workspace_id
  ) then
    raise exception 'creative_studio_creatives.concept_id must belong to the same batch and workspace' using errcode = '23514';
  end if;
  if new.rendered_media_asset_id is not null and not exists (
    select 1 from public.content_media_assets
    where id = new.rendered_media_asset_id and workspace_id = new.workspace_id
  ) then
    raise exception 'creative_studio_creatives.rendered_media_asset_id must belong to the same workspace' using errcode = '23514';
  end if;
  -- V1 hard ceiling: max 30 final rendered ads per batch (instruction #10).
  if tg_op = 'INSERT' then
    select count(*) into v_concept_count
    from public.creative_studio_creatives
    where batch_id = new.batch_id;
    if v_concept_count >= 30 then
      raise exception 'creative_studio batch % already has the maximum of 30 rendered creatives', new.batch_id
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists creative_studio_creatives_validate_workspace_trg on public.creative_studio_creatives;
create trigger creative_studio_creatives_validate_workspace_trg
  before insert or update on public.creative_studio_creatives
  for each row execute function public.creative_studio_creatives_validate_workspace();

-- ---------------------------------------------------------------------------
-- RLS - reuse the content taxonomy exactly (instruction #23).
--   select  -> content.view
--   write   -> content.create
-- Heavy writes (concepts/visuals/renders) run server-side under the
-- service role; the client uses these policies for the gallery read and
-- the review actions (approve / reject / edit copy).
-- ---------------------------------------------------------------------------
alter table public.creative_studio_batches enable row level security;
alter table public.creative_studio_concepts enable row level security;
alter table public.creative_studio_creatives enable row level security;

drop policy if exists "creative_studio_batches_select" on public.creative_studio_batches;
create policy "creative_studio_batches_select"
on public.creative_studio_batches for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.view'));

drop policy if exists "creative_studio_batches_write" on public.creative_studio_batches;
create policy "creative_studio_batches_write"
on public.creative_studio_batches for all
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.create'))
with check (public.has_workspace_permission(workspace_id, 'content.create'));

drop policy if exists "creative_studio_concepts_select" on public.creative_studio_concepts;
create policy "creative_studio_concepts_select"
on public.creative_studio_concepts for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.view'));

drop policy if exists "creative_studio_concepts_write" on public.creative_studio_concepts;
create policy "creative_studio_concepts_write"
on public.creative_studio_concepts for all
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.create'))
with check (public.has_workspace_permission(workspace_id, 'content.create'));

drop policy if exists "creative_studio_creatives_select" on public.creative_studio_creatives;
create policy "creative_studio_creatives_select"
on public.creative_studio_creatives for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.view'));

drop policy if exists "creative_studio_creatives_write" on public.creative_studio_creatives;
create policy "creative_studio_creatives_write"
on public.creative_studio_creatives for all
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.create'))
with check (public.has_workspace_permission(workspace_id, 'content.create'));

comment on table public.creative_studio_batches is
  'Creative Studio batch image ad generation: one row per "Generate creatives" run. Extends the existing copy-only Creative Studio.';
comment on table public.creative_studio_concepts is
  'Structured visual concept (concept_name/headline/supporting_text/CTA/visual_prompt/...). Exactly one AI background visual per concept.';
comment on table public.creative_studio_creatives is
  'Final deterministically-rendered advert. id = stable creative_id for future creative-level attribution. Text columns are the renderer''s source of truth.';
