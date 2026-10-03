-- Creative Studio: reference-advert generation + Brand Kit completion.
--
-- Three additive, nullable/default-safe changes - no existing row is
-- reclassified and no existing rendering behaviour changes unless a
-- workspace actually sets the new fields:
--
--  1. workspace_settings gains the two genuinely missing Brand Kit fields
--     (brand_primary_color/brand_accent_color/brand_cta_text_color/
--     ad_footer_disclaimer already exist from 20260930070000 but were
--     never exposed in Settings - this migration does not touch them).
--  2. content_media_assets gains a NULLABLE asset_role. It is reusable
--     Media Library metadata only - it never gates whether an asset can
--     be used as a reference in Creative Studio (that decision is made
--     per-generation by the caller; see creative-studio-concepts).
--  3. creative_studio_batches gains reference_style (cached structured
--     vision-analysis output) and reference_preferences (the user's
--     keep-colours/keep-layout/keep-imagery/fresh-layout choice), both
--     nullable so a no-reference batch is byte-identical to today.

-- ---------------------------------------------------------------------------
-- workspace_settings: secondary brand colour + default CTA fallback.
-- ---------------------------------------------------------------------------
alter table public.workspace_settings
  add column if not exists secondary_brand_color text
    check (secondary_brand_color is null or secondary_brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists default_ad_cta text
    check (default_ad_cta is null or length(trim(default_ad_cta)) between 1 and 40);

comment on column public.workspace_settings.secondary_brand_color is
  'Creative Studio ad renderer: secondary brand colour (#RRGGBB), alongside brand_primary_color/brand_accent_color.';
comment on column public.workspace_settings.default_ad_cta is
  'Brand Kit fallback CTA label. Lowest-priority source only: a user-edited/approved creative CTA or an AI-generated concept CTA always wins. NULL -> renderer''s existing hardcoded fallback.';

-- ---------------------------------------------------------------------------
-- content_media_assets: nullable classification, never a gate.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'content_asset_role') then
    create type public.content_asset_role as enum ('reference_creative', 'product_image', 'logo', 'background');
  end if;
end $$;

alter table public.content_media_assets
  add column if not exists asset_role public.content_asset_role;

comment on column public.content_media_assets.asset_role is
  'Optional Media Library classification. NULL = unclassified, and unclassified assets remain fully usable everywhere including as a Creative Studio reference - this column is a UI hint/filter, never an access or eligibility gate.';

-- ---------------------------------------------------------------------------
-- creative_studio_batches: cached reference-style analysis + preferences.
-- One reference is analyzed once per batch and shared by every concept in
-- it (see creative-studio-concepts), matching the existing "one AI image
-- call per concept, not per rendered creative" economy.
-- ---------------------------------------------------------------------------
alter table public.creative_studio_batches
  add column if not exists reference_style jsonb,
  add column if not exists reference_preferences jsonb;

comment on column public.creative_studio_batches.reference_style is
  'Cached structured output of the one-time reference-advert vision analysis: {dominant_colors, layout_style, subject_position, text_regions, visual_style, background_style, whitespace_level, mood}. Style guidance only - never commercial facts (no OCR''d headline/price/phone/CTA is ever stored here).';
comment on column public.creative_studio_batches.reference_preferences is
  'User''s reference-advert controls for this batch: {"keep_colours": bool, "keep_layout": bool, "keep_imagery": bool, "fresh_layout": bool}. NULL when no reference was used or "Fresh layout using my branding" was chosen without any keep_* toggle.';
