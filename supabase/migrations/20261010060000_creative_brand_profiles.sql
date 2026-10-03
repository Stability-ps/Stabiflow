-- Creative Studio: reusable Brand Profiles + generation-time brand
-- snapshot.
--
-- Design decisions:
--  * workspace_settings' ad-brand columns (brand_primary_color,
--    secondary_brand_color, brand_accent_color, brand_cta_text_color,
--    default_ad_cta, ad_footer_disclaimer, logo_path, contact_email,
--    contact_phone, website) are NOT removed or duplicated in meaning -
--    they remain the legacy/fallback brand source for workspaces that
--    have not yet created an explicit profile, and for batches created
--    before this migration (brand_snapshot is null on those). This is a
--    deliberate compatibility strategy: one authoritative editing
--    surface (Creative Studio) going forward, one fallback read source
--    (workspace_settings) that is never written to by the new profile
--    UI, so the two can never drift out of sync with each other.
--  * A workspace can have MANY named brand profiles (e.g. running ads
--    for several client brands from one agency workspace). At most one
--    is_default per workspace, enforced by a partial unique index.
--  * Brand-profile logos reuse the existing private content_media_assets
--    table/content-media bucket (asset_role = 'logo', already a valid
--    enum value from 20261005060000) rather than introducing a second
--    logo storage path or any public URL.
--  * Every creative_studio_batches row now carries brand_profile_id (an
--    audit pointer, may become null if the profile is later deleted) AND
--    brand_snapshot jsonb (the actual rendering-time values, copied at
--    concept-generation time). The renderer (creative-studio-render
--    plan action) always prefers brand_snapshot over the live profile/
--    workspace_settings, so a brand's phone number or colours changing
--    next month can never repaint history - old creatives keep showing
--    what they were actually generated with. The snapshot stores only
--    small rendering-relevant fields (never image bytes - the logo is
--    referenced by its existing content_media_assets id/storage_path,
--    resolved to a fresh signed URL at render time).
--  * Permissions reuse the existing content taxonomy exactly like the
--    rest of Creative Studio (instruction #23): content.view to read,
--    content.create to write. No new permission names.
-- ---------------------------------------------------------------------------

create table if not exists public.creative_brand_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  company_name text not null check (length(trim(company_name)) between 1 and 200),
  logo_media_asset_id uuid references public.content_media_assets(id) on delete set null,
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text check (secondary_color is null or secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  cta_text_color text check (cta_text_color is null or cta_text_color ~ '^#[0-9A-Fa-f]{6}$'),
  contact_phone text check (contact_phone is null or length(contact_phone) <= 50),
  whatsapp_number text check (whatsapp_number is null or length(whatsapp_number) <= 50),
  contact_email text check (contact_email is null or length(contact_email) <= 320),
  website text check (website is null or length(website) <= 500),
  address text check (address is null or length(address) <= 300),
  default_cta text check (default_cta is null or length(default_cta) <= 40),
  footer_disclaimer text check (footer_disclaimer is null or length(footer_disclaimer) <= 300),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creative_brand_profiles_workspace_idx
  on public.creative_brand_profiles (workspace_id, created_at desc);

-- At most one default profile per workspace. A plain unique index (not a
-- constraint) so it can be partial (`where is_default`) - Postgres has no
-- partial unique table constraint syntax.
create unique index if not exists creative_brand_profiles_one_default_idx
  on public.creative_brand_profiles (workspace_id)
  where is_default;

drop trigger if exists set_creative_brand_profiles_updated_at on public.creative_brand_profiles;
create trigger set_creative_brand_profiles_updated_at
  before update on public.creative_brand_profiles
  for each row execute function public.set_updated_at();

create or replace function public.creative_brand_profiles_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.logo_media_asset_id is not null and not exists (
    select 1 from public.content_media_assets
    where id = new.logo_media_asset_id and workspace_id = new.workspace_id
  ) then
    raise exception 'creative_brand_profiles.logo_media_asset_id must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists creative_brand_profiles_validate_workspace_trg on public.creative_brand_profiles;
create trigger creative_brand_profiles_validate_workspace_trg
  before insert or update on public.creative_brand_profiles
  for each row execute function public.creative_brand_profiles_validate_workspace();

alter table public.creative_brand_profiles enable row level security;

drop policy if exists "creative_brand_profiles_select" on public.creative_brand_profiles;
create policy "creative_brand_profiles_select"
on public.creative_brand_profiles for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.view'));

drop policy if exists "creative_brand_profiles_write" on public.creative_brand_profiles;
create policy "creative_brand_profiles_write"
on public.creative_brand_profiles for all
to authenticated
using (public.has_workspace_permission(workspace_id, 'content.create'))
with check (public.has_workspace_permission(workspace_id, 'content.create'));

comment on table public.creative_brand_profiles is
  'Reusable named brand/company setups for Creative Studio one-click ad generation. workspace_settings brand-kit columns remain the legacy fallback source, never written to by this table''s editor.';

-- ---------------------------------------------------------------------------
-- creative_studio_batches: brand snapshot + full brief persistence, so a
-- batch can be reopened later with everything the user originally chose
-- (instruction #22), and so history never depends on the CURRENT mutable
-- brand profile (instruction #7).
-- ---------------------------------------------------------------------------
alter table public.creative_studio_batches
  add column if not exists brand_profile_id uuid references public.creative_brand_profiles(id) on delete set null,
  add column if not exists brand_snapshot jsonb,
  add column if not exists visual_direction text check (visual_direction is null or length(visual_direction) <= 500),
  add column if not exists user_headline text check (user_headline is null or length(user_headline) <= 120),
  add column if not exists user_body_text text check (user_body_text is null or length(user_body_text) <= 400),
  add column if not exists user_cta text check (user_cta is null or length(user_cta) <= 40),
  -- Which contact fields the renderer should include in the composited
  -- "info bits" line (instruction #16 - smart information density).
  -- Deterministic default matches the documented primary/secondary
  -- strategy: phone + whatsapp primary, website secondary.
  add column if not exists contact_fields text[] not null default array['phone', 'whatsapp', 'website'];

comment on column public.creative_studio_batches.brand_profile_id is
  'Which creative_brand_profiles row was selected at generation time. Audit pointer only - may become null if the profile is later deleted; brand_snapshot is what actually renders.';
comment on column public.creative_studio_batches.brand_snapshot is
  'Rendering-relevant brand fields captured at concept-generation time (name, colours, logo asset id, contact fields, default CTA, footer). Never re-read live from the profile/workspace_settings after generation - preserves what a creative was ACTUALLY generated with even if the brand profile changes later. No image bytes stored here, only the existing content_media_assets id/storage_path for the logo.';
comment on column public.creative_studio_batches.visual_direction is
  'Optional free-text scene/mood description supplied by the user (instruction #8), passed through to concept generation as additional creative direction. Never a source of commercial fact.';
comment on column public.creative_studio_batches.user_headline is
  'User-supplied headline for this batch, if any. Authoritative over AI-generated copy (instruction #9) - applied to every concept verbatim.';
comment on column public.creative_studio_batches.user_body_text is
  'User-supplied supporting/body text for this batch, if any. Authoritative over AI-generated copy.';
comment on column public.creative_studio_batches.user_cta is
  'User-supplied CTA for this batch, if any. Authoritative over AI-generated and brand-default CTA (see resolveCta in lib/adRenderer/layout.ts).';
