-- Business Identity: the canonical, provenance-tracked record of WHO a
-- workspace's business is. Foundation for Business Studio (website ->
-- company profile), hosted profiles and website monitoring.
--
-- Design decisions:
--  * ONE identity per workspace (business_identities.workspace_id is
--    unique). Every child table (contacts, locations, social links,
--    offerings, team, projects, certifications, identifiers) references
--    business_identities(workspace_id), so a child row can never exist
--    without its identity or point at another tenant's identity.
--  * No duplicate source of truth:
--      - Branding (logo/colours) is NOT copied here. brand_profile_id
--        points at the existing creative_brand_profiles row (Creative
--        Studio remains the one brand editor).
--      - workspace_settings.website / industry / business_description /
--        contact_email / contact_phone pre-date this table and are read by
--        existing screens and edge functions. They are kept in sync with
--        the identity by guarded triggers in BOTH directions, so either
--        surface can be edited without the two drifting. pg_trigger_depth
--        guards stop the sync from recursing.
--  * Provenance on every fact: `source` (where it came from), `source_ref`
--    (URL / scan id / upload id), `verification_status`. Scalar identity
--    fields carry per-field provenance in `field_provenance` jsonb
--    ({"website": {"source": "website_scan", "source_ref": "...",
--    "confirmed_at": "..."}}) because a column-per-field provenance
--    scheme would triple the width of the table.
--  * verification_status = 'verified' means verified by the PLATFORM
--    (operator / trusted backend check), not by the customer - a customer
--    can only mark a fact 'user_confirmed'. Enforced by trigger: only
--    service_role may set or keep a row at 'verified' through a change.
--  * RLS: any member reads; admin+ writes. Same gate as workspace_settings
--    (a business-profile change is a workspace-profile-level action).
-- ---------------------------------------------------------------------------

-- Shared enumerations as check-constrained text (this codebase's
-- convention for extensible value sets - see creative studio / billing).

create or replace function public.business_fact_source_valid(p_source text)
returns boolean
language sql
immutable
as $$
  select p_source in ('user', 'website_scan', 'document_upload', 'ai_suggestion', 'backfill', 'operator', 'import');
$$;

create or replace function public.business_fact_verification_valid(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('unverified', 'user_confirmed', 'verified', 'rejected');
$$;

-- business_identities ---------------------------------------------------------

create table if not exists public.business_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  legal_name text check (legal_name is null or length(trim(legal_name)) between 1 and 200),
  trading_name text check (trading_name is null or length(trim(trading_name)) between 1 and 200),
  country_code text not null default 'ZA' check (country_code ~ '^[A-Z]{2}$'),
  website text check (website is null or length(website) <= 500),
  industry text check (industry is null or length(industry) <= 200),
  tagline text check (tagline is null or length(tagline) <= 160),
  short_description text check (short_description is null or length(short_description) <= 500),
  long_description text check (long_description is null or length(long_description) <= 5000),
  mission text check (mission is null or length(mission) <= 1000),
  vision text check (vision is null or length(vision) <= 1000),
  core_values text[] not null default '{}' check (cardinality(core_values) <= 20),
  founded_year integer check (founded_year is null or founded_year between 1800 and 2100),
  employee_count_range text check (employee_count_range is null or employee_count_range in ('1', '2-10', '11-50', '51-200', '201-500', '501-1000', '1000+')),
  brand_profile_id uuid references public.creative_brand_profiles(id) on delete set null,
  field_provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(field_provenance) = 'object'),
  verification_status text not null default 'unverified' check (public.business_fact_verification_valid(verification_status)),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_business_identities_updated_at on public.business_identities;
create trigger set_business_identities_updated_at before update on public.business_identities
  for each row execute function public.set_updated_at();

-- Child tables ------------------------------------------------------------------
-- Every child shares the same provenance columns. Written out per table
-- (not generated dynamically) so each table's DDL stays greppable.

create table if not exists public.business_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.business_identities(workspace_id) on delete cascade,
  kind text not null check (kind in ('email', 'phone', 'whatsapp', 'fax', 'other')),
  label text check (label is null or length(label) <= 80),
  value text not null check (length(trim(value)) between 1 and 320),
  is_primary boolean not null default false,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  source text not null default 'user' check (public.business_fact_source_valid(source)),
  source_ref text check (source_ref is null or length(source_ref) <= 2000),
  verification_status text not null default 'unverified' check (public.business_fact_verification_valid(verification_status)),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_contacts_workspace_idx on public.business_contacts (workspace_id, kind, sort_order);
create unique index if not exists business_contacts_one_primary_per_kind
  on public.business_contacts (workspace_id, kind) where is_primary;

create table if not exists public.business_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.business_identities(workspace_id) on delete cascade,
  label text check (label is null or length(label) <= 80),
  address_line1 text check (address_line1 is null or length(address_line1) <= 300),
  address_line2 text check (address_line2 is null or length(address_line2) <= 300),
  city text check (city is null or length(city) <= 120),
  region text check (region is null or length(region) <= 120),
  postal_code text check (postal_code is null or length(postal_code) <= 20),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  is_primary boolean not null default false,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  source text not null default 'user' check (public.business_fact_source_valid(source)),
  source_ref text check (source_ref is null or length(source_ref) <= 2000),
  verification_status text not null default 'unverified' check (public.business_fact_verification_valid(verification_status)),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(address_line1, city, region, postal_code) is not null)
);
create index if not exists business_locations_workspace_idx on public.business_locations (workspace_id, sort_order);
create unique index if not exists business_locations_one_primary
  on public.business_locations (workspace_id) where is_primary;

create table if not exists public.business_social_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.business_identities(workspace_id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'youtube', 'pinterest', 'google_business', 'other')),
  url text not null check (url ~* '^https?://' and length(url) <= 500),
  sort_order integer not null default 0,
  source text not null default 'user' check (public.business_fact_source_valid(source)),
  source_ref text check (source_ref is null or length(source_ref) <= 2000),
  verification_status text not null default 'unverified' check (public.business_fact_verification_valid(verification_status)),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_social_links_workspace_idx on public.business_social_links (workspace_id, sort_order);

create table if not exists public.business_offerings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.business_identities(workspace_id) on delete cascade,
  kind text not null default 'service' check (kind in ('service', 'product')),
  name text not null check (length(trim(name)) between 1 and 160),
  description text check (description is null or length(description) <= 2000),
  price_text text check (price_text is null or length(price_text) <= 80),
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  source text not null default 'user' check (public.business_fact_source_valid(source)),
  source_ref text check (source_ref is null or length(source_ref) <= 2000),
  verification_status text not null default 'unverified' check (public.business_fact_verification_valid(verification_status)),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_offerings_workspace_idx on public.business_offerings (workspace_id, sort_order);

create table if not exists public.business_team_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.business_identities(workspace_id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 160),
  role_title text check (role_title is null or length(role_title) <= 120),
  bio text check (bio is null or length(bio) <= 1500),
  photo_media_asset_id uuid references public.content_media_assets(id) on delete set null,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  source text not null default 'user' check (public.business_fact_source_valid(source)),
  source_ref text check (source_ref is null or length(source_ref) <= 2000),
  verification_status text not null default 'unverified' check (public.business_fact_verification_valid(verification_status)),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_team_members_workspace_idx on public.business_team_members (workspace_id, sort_order);

create table if not exists public.business_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.business_identities(workspace_id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  client_name text check (client_name is null or length(client_name) <= 200),
  description text check (description is null or length(description) <= 2000),
  location text check (location is null or length(location) <= 200),
  completed_year integer check (completed_year is null or completed_year between 1800 and 2100),
  cover_media_asset_id uuid references public.content_media_assets(id) on delete set null,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  source text not null default 'user' check (public.business_fact_source_valid(source)),
  source_ref text check (source_ref is null or length(source_ref) <= 2000),
  verification_status text not null default 'unverified' check (public.business_fact_verification_valid(verification_status)),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_projects_workspace_idx on public.business_projects (workspace_id, sort_order);

create table if not exists public.business_certifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.business_identities(workspace_id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  issuer text check (issuer is null or length(issuer) <= 200),
  credential_id text check (credential_id is null or length(credential_id) <= 120),
  issued_on date,
  expires_on date,
  document_media_asset_id uuid references public.content_media_assets(id) on delete set null,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  source text not null default 'user' check (public.business_fact_source_valid(source)),
  source_ref text check (source_ref is null or length(source_ref) <= 2000),
  verification_status text not null default 'unverified' check (public.business_fact_verification_valid(verification_status)),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index if not exists business_certifications_workspace_idx on public.business_certifications (workspace_id, sort_order);

-- Country-specific registration identifiers (CIPC number, VAT, B-BBEE
-- level, CSD supplier number, ...). A scheme vocabulary rather than one
-- column per country keeps this usable beyond South Africa. Private by
-- default: a tax reference is not something to print on a public profile
-- unless the owner opts in.
create table if not exists public.business_identifiers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.business_identities(workspace_id) on delete cascade,
  country_code text not null default 'ZA' check (country_code ~ '^[A-Z]{2}$'),
  scheme text not null check (scheme ~ '^[a-z0-9_]{2,40}$'),
  value text not null check (length(trim(value)) between 1 and 120),
  is_public boolean not null default false,
  source text not null default 'user' check (public.business_fact_source_valid(source)),
  source_ref text check (source_ref is null or length(source_ref) <= 2000),
  verification_status text not null default 'unverified' check (public.business_fact_verification_valid(verification_status)),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, country_code, scheme)
);

-- updated_at triggers for the children.
do $$
declare
  t text;
begin
  foreach t in array array['business_contacts', 'business_locations', 'business_social_links', 'business_offerings',
                           'business_team_members', 'business_projects', 'business_certifications', 'business_identifiers']
  loop
    execute format('drop trigger if exists set_%1$s_updated_at on public.%1$I', t);
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end
$$;

-- Guard: only the platform may mark a fact 'verified' ----------------------------
-- A customer confirming their own data is 'user_confirmed'. 'verified' is
-- reserved for operator/backend verification, so a client write can never
-- set it, and a client edit of an already-verified row demotes it back to
-- 'user_confirmed' (the edited value has not been verified).
create or replace function public.business_fact_guard_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.verification_status = 'verified' then
    if tg_op = 'INSERT' or old.verification_status is distinct from 'verified' then
      raise exception 'Only the platform can mark business information as verified' using errcode = '42501';
    end if;
    -- An edit by a client to an already-verified row: demote.
    new.verification_status := 'user_confirmed';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['business_identities', 'business_contacts', 'business_locations', 'business_social_links', 'business_offerings',
                           'business_team_members', 'business_projects', 'business_certifications', 'business_identifiers']
  loop
    execute format('drop trigger if exists %1$s_guard_verification_trg on public.%1$I', t);
    execute format('create trigger %1$s_guard_verification_trg before insert or update on public.%1$I for each row execute function public.business_fact_guard_verification()', t);
  end loop;
end
$$;

-- Identity-level verification metadata is platform-only too.
create or replace function public.business_identities_guard_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
    new.workspace_id := old.workspace_id;
  else
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists business_identities_guard_meta_trg on public.business_identities;
create trigger business_identities_guard_meta_trg before insert or update on public.business_identities
  for each row execute function public.business_identities_guard_meta();

-- Cross-tenant reference validation --------------------------------------------
-- FKs to creative_brand_profiles / content_media_assets only prove the row
-- exists, not that it belongs to THIS workspace.

create or replace function public.business_identities_validate_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.brand_profile_id is not null and not exists (
    select 1 from public.creative_brand_profiles where id = new.brand_profile_id and workspace_id = new.workspace_id
  ) then
    raise exception 'business_identities.brand_profile_id must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists business_identities_validate_refs_trg on public.business_identities;
create trigger business_identities_validate_refs_trg before insert or update on public.business_identities
  for each row execute function public.business_identities_validate_refs();

create or replace function public.business_child_validate_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset uuid;
begin
  v_asset := case tg_table_name
    when 'business_team_members' then new.photo_media_asset_id
    when 'business_projects' then new.cover_media_asset_id
    when 'business_certifications' then new.document_media_asset_id
  end;
  if v_asset is not null and not exists (
    select 1 from public.content_media_assets where id = v_asset and workspace_id = new.workspace_id
  ) then
    raise exception '%: media asset must belong to the same workspace', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists business_team_members_validate_media_trg on public.business_team_members;
create trigger business_team_members_validate_media_trg before insert or update on public.business_team_members
  for each row execute function public.business_child_validate_media();
drop trigger if exists business_projects_validate_media_trg on public.business_projects;
create trigger business_projects_validate_media_trg before insert or update on public.business_projects
  for each row execute function public.business_child_validate_media();
drop trigger if exists business_certifications_validate_media_trg on public.business_certifications;
create trigger business_certifications_validate_media_trg before insert or update on public.business_certifications
  for each row execute function public.business_child_validate_media();

-- RLS ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['business_identities', 'business_contacts', 'business_locations', 'business_social_links', 'business_offerings',
                           'business_team_members', 'business_projects', 'business_certifications', 'business_identifiers']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%1$s_select_member" on public.%1$I', t);
    execute format('create policy "%1$s_select_member" on public.%1$I for select to authenticated using (public.is_workspace_member(workspace_id))', t);
    execute format('drop policy if exists "%1$s_write_admin" on public.%1$I', t);
    execute format(
      'create policy "%1$s_write_admin" on public.%1$I for all to authenticated '
      'using (public.has_workspace_role(workspace_id, ''admin'')) '
      'with check (public.has_workspace_role(workspace_id, ''admin''))', t);
  end loop;
end
$$;

-- The identity row itself is created by the platform (workspace trigger /
-- backfill) and removed only with its workspace - no client INSERT/DELETE.
drop policy if exists "business_identities_write_admin" on public.business_identities;
drop policy if exists "business_identities_update_admin" on public.business_identities;
create policy "business_identities_update_admin" on public.business_identities for update to authenticated
  using (public.has_workspace_role(workspace_id, 'admin'))
  with check (public.has_workspace_role(workspace_id, 'admin'));

-- Legacy workspace_settings <-> identity sync ------------------------------------

create or replace function public.business_identities_sync_to_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  update public.workspace_settings s
  set website = new.website,
      industry = new.industry,
      business_description = left(new.long_description, 2000)
  where s.workspace_id = new.workspace_id
    and (s.website is distinct from new.website
      or s.industry is distinct from new.industry
      or s.business_description is distinct from left(new.long_description, 2000));
  return new;
end;
$$;

drop trigger if exists business_identities_sync_to_settings_trg on public.business_identities;
create trigger business_identities_sync_to_settings_trg
  after insert or update of website, industry, long_description on public.business_identities
  for each row execute function public.business_identities_sync_to_settings();

-- Primary email/phone contact -> workspace_settings.contact_email/phone.
create or replace function public.business_contacts_sync_to_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid := coalesce(new.workspace_id, old.workspace_id);
  v_email text;
  v_phone text;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  select value into v_email from public.business_contacts where workspace_id = v_ws and kind = 'email' and is_primary limit 1;
  select value into v_phone from public.business_contacts where workspace_id = v_ws and kind = 'phone' and is_primary limit 1;
  -- contact_email has a format check on workspace_settings; only mirror a
  -- value that satisfies it rather than failing the contact write.
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_email := null;
  end if;
  update public.workspace_settings s
  set contact_email = v_email,
      contact_phone = left(v_phone, 50)
  where s.workspace_id = v_ws
    and (s.contact_email is distinct from v_email or s.contact_phone is distinct from left(v_phone, 50));
  return coalesce(new, old);
end;
$$;

drop trigger if exists business_contacts_sync_to_settings_trg on public.business_contacts;
create trigger business_contacts_sync_to_settings_trg
  after insert or update or delete on public.business_contacts
  for each row execute function public.business_contacts_sync_to_settings();

-- workspace_settings edits (existing Settings screen) -> identity.
create or replace function public.workspace_settings_sync_to_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  update public.business_identities i
  set website = new.website,
      industry = new.industry,
      long_description = new.business_description,
      field_provenance = i.field_provenance || jsonb_build_object(
        'website', jsonb_build_object('source', 'user', 'updated_at', now()),
        'industry', jsonb_build_object('source', 'user', 'updated_at', now()),
        'long_description', jsonb_build_object('source', 'user', 'updated_at', now()))
  where i.workspace_id = new.workspace_id
    and (i.website is distinct from new.website
      or i.industry is distinct from new.industry
      or i.long_description is distinct from new.business_description);

  if tg_op = 'INSERT' or new.contact_email is distinct from old.contact_email then
    perform public.business_upsert_primary_contact(new.workspace_id, 'email', new.contact_email);
  end if;
  if tg_op = 'INSERT' or new.contact_phone is distinct from old.contact_phone then
    perform public.business_upsert_primary_contact(new.workspace_id, 'phone', new.contact_phone);
  end if;
  return new;
end;
$$;

create or replace function public.business_upsert_primary_contact(p_workspace_id uuid, p_kind text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.business_identities where workspace_id = p_workspace_id) then
    return;
  end if;
  if p_value is null or length(trim(p_value)) = 0 then
    delete from public.business_contacts where workspace_id = p_workspace_id and kind = p_kind and is_primary;
    return;
  end if;
  update public.business_contacts
  set value = p_value, source = 'user'
  where workspace_id = p_workspace_id and kind = p_kind and is_primary and value is distinct from p_value;
  if not found and not exists (
    select 1 from public.business_contacts where workspace_id = p_workspace_id and kind = p_kind and is_primary
  ) then
    insert into public.business_contacts (workspace_id, kind, value, is_primary, source)
    values (p_workspace_id, p_kind, p_value, true, 'user');
  end if;
end;
$$;

revoke execute on function public.business_upsert_primary_contact(uuid, text, text) from public, anon, authenticated;

drop trigger if exists workspace_settings_sync_to_identity_trg on public.workspace_settings;
create trigger workspace_settings_sync_to_identity_trg
  after update of website, industry, business_description, contact_email, contact_phone on public.workspace_settings
  for each row execute function public.workspace_settings_sync_to_identity();

-- Every new workspace gets its identity row ------------------------------------

create or replace function public.workspaces_create_business_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.business_identities (workspace_id, trading_name, field_provenance)
  values (new.id, left(new.name, 200), jsonb_build_object('trading_name', jsonb_build_object('source', 'user', 'updated_at', now())))
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

drop trigger if exists workspaces_create_business_identity_trg on public.workspaces;
create trigger workspaces_create_business_identity_trg
  after insert on public.workspaces
  for each row execute function public.workspaces_create_business_identity();

-- Backfill existing workspaces --------------------------------------------------
-- Everything backfilled is marked source='backfill', verification
-- 'unverified': it was typed by the customer earlier, but never reviewed
-- in the context of a public company profile.

insert into public.business_identities (workspace_id, trading_name, website, industry, long_description, brand_profile_id, field_provenance)
select
  w.id,
  left(w.name, 200),
  s.website,
  s.industry,
  s.business_description,
  bp.id,
  jsonb_strip_nulls(jsonb_build_object(
    'trading_name', jsonb_build_object('source', 'backfill', 'source_ref', 'workspaces.name'),
    'website', case when s.website is not null then jsonb_build_object('source', 'backfill', 'source_ref', 'workspace_settings.website') end,
    'industry', case when s.industry is not null then jsonb_build_object('source', 'backfill', 'source_ref', 'workspace_settings.industry') end,
    'long_description', case when s.business_description is not null then jsonb_build_object('source', 'backfill', 'source_ref', 'workspace_settings.business_description') end
  ))
from public.workspaces w
left join public.workspace_settings s on s.workspace_id = w.id
left join public.creative_brand_profiles bp on bp.workspace_id = w.id and bp.is_default
on conflict (workspace_id) do nothing;

insert into public.business_contacts (workspace_id, kind, value, is_primary, source, source_ref)
select s.workspace_id, 'email', s.contact_email, true, 'backfill', 'workspace_settings.contact_email'
from public.workspace_settings s
join public.business_identities i on i.workspace_id = s.workspace_id
where s.contact_email is not null and length(trim(s.contact_email)) > 0
on conflict do nothing;

insert into public.business_contacts (workspace_id, kind, value, is_primary, source, source_ref)
select s.workspace_id, 'phone', s.contact_phone, true, 'backfill', 'workspace_settings.contact_phone'
from public.workspace_settings s
join public.business_identities i on i.workspace_id = s.workspace_id
where s.contact_phone is not null and length(trim(s.contact_phone)) > 0
on conflict do nothing;

-- Default brand profile's WhatsApp and address (not held anywhere else).
insert into public.business_contacts (workspace_id, kind, value, is_primary, source, source_ref)
select bp.workspace_id, 'whatsapp', bp.whatsapp_number, true, 'backfill', 'creative_brand_profiles.' || bp.id
from public.creative_brand_profiles bp
join public.business_identities i on i.workspace_id = bp.workspace_id
where bp.is_default and bp.whatsapp_number is not null and length(trim(bp.whatsapp_number)) > 0
on conflict do nothing;

insert into public.business_locations (workspace_id, address_line1, is_primary, source, source_ref)
select bp.workspace_id, bp.address, true, 'backfill', 'creative_brand_profiles.' || bp.id
from public.creative_brand_profiles bp
join public.business_identities i on i.workspace_id = bp.workspace_id
where bp.is_default and bp.address is not null and length(trim(bp.address)) > 0
on conflict do nothing;

comment on table public.business_identities is
  'Canonical business identity per workspace (Business Studio). Branding lives in creative_brand_profiles (brand_profile_id). website/industry/long_description and primary email/phone contacts are kept in sync with the legacy workspace_settings columns by trigger.';
