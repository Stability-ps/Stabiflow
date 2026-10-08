-- Business Studio: website scans, reviewable fact proposals, profile
-- documents, profile templates, hosted business profiles and website
-- monitoring.
--
-- Core rule: NOTHING a scan, the monitor or the AI produces is written to
-- the Business Identity directly. Everything lands in
-- business_fact_proposals (with evidence) and only an explicit customer
-- accept (accept_business_fact_proposal) applies it. Monitoring therefore
-- can never overwrite approved information.
-- ---------------------------------------------------------------------------

-- Scans ------------------------------------------------------------------------------

create table if not exists public.website_scans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_url text not null check (length(requested_url) <= 500),
  final_url text check (final_url is null or length(final_url) <= 2000),
  purpose text not null default 'onboarding' check (purpose in ('onboarding', 'manual', 'monitoring')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'blocked')),
  pages_fetched integer not null default 0,
  error text check (error is null or length(error) <= 500),
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists website_scans_workspace_idx on public.website_scans (workspace_id, created_at desc);

create table if not exists public.website_scan_pages (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.website_scans(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  url text not null check (length(url) <= 2000),
  http_status integer,
  title text check (title is null or length(title) <= 300),
  content_hash text,
  -- Plain text only (tags/scripts stripped server-side), capped. Kept as
  -- evidence for proposals and as the baseline for monitoring diffs.
  text_excerpt text check (text_excerpt is null or length(text_excerpt) <= 20000),
  fetched_at timestamptz not null default now()
);
create index if not exists website_scan_pages_scan_idx on public.website_scan_pages (scan_id);

-- Proposals ------------------------------------------------------------------------

create table if not exists public.business_fact_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scan_id uuid references public.website_scans(id) on delete set null,
  origin text not null check (origin in ('website_scan', 'monitoring', 'ai_wording', 'document_upload')),
  target text not null check (target in ('identity_field', 'contact', 'location', 'social_link', 'offering', 'team_member', 'project', 'certification', 'identifier')),
  -- identity_field: the column name (allow-listed in the accept function).
  field text check (field is null or field ~ '^[a-z_]{2,40}$'),
  proposed jsonb not null check (jsonb_typeof(proposed) = 'object'),
  current_value jsonb,
  evidence text check (evidence is null or length(evidence) <= 600),
  evidence_url text check (evidence_url is null or length(evidence_url) <= 2000),
  extraction_method text not null check (extraction_method in ('structured_data', 'pattern', 'ai_extraction', 'ai_wording')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'superseded')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  applied_ref text,
  created_at timestamptz not null default now()
);
create index if not exists business_fact_proposals_pending_idx on public.business_fact_proposals (workspace_id, status, created_at desc);

-- Templates (admin-editable) --------------------------------------------------------

create table if not exists public.profile_templates (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 500),
  is_premium boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  -- Layout parameters consumed by BOTH the browser preview and the PDF
  -- renderer (layout, accent usage, fonts) - never code.
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  updated_at timestamptz not null default now()
);

insert into public.profile_templates (key, name, description, is_premium, sort_order, config) values
  ('classic', 'Classic', 'Clean, traditional layout with a coloured header band.', false, 10, '{"layout": "band", "headingFont": "serif"}'),
  ('modern', 'Modern', 'Bold cover with a side accent bar.', true, 20, '{"layout": "sidebar", "headingFont": "sans"}'),
  ('executive', 'Executive', 'Minimal, generous whitespace, accent rules.', true, 30, '{"layout": "minimal", "headingFont": "serif"}')
on conflict (key) do nothing;

-- Documents ----------------------------------------------------------------------------

create table if not exists public.business_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null default 'company_profile' check (kind in ('company_profile')),
  title text not null check (length(trim(title)) between 1 and 200),
  template_key text not null references public.profile_templates(key),
  status text not null default 'generated' check (status in ('generated', 'failed')),
  -- The exact facts rendered (snapshot) - later identity edits never
  -- change an existing document.
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  storage_path text,
  watermarked boolean not null default true,
  page_count integer,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists business_documents_workspace_idx on public.business_documents (workspace_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('business-documents', 'business-documents', false)
on conflict (id) do update set public = false;

drop policy if exists "business_documents_storage_select_member" on storage.objects;
create policy "business_documents_storage_select_member"
on storage.objects for select
to authenticated
using (
  bucket_id = 'business-documents'
  and public.is_workspace_member(public.workspace_assets_path_workspace_id(name))
);
-- No client insert/update/delete on this bucket: documents are written only
-- by the business-studio edge function (service role) after checking
-- entitlements.

-- Hosted profiles ------------------------------------------------------------------

create table if not exists public.hosted_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$'),
  is_published boolean not null default false,
  published_at timestamptz,
  template_key text not null default 'classic' references public.profile_templates(key),
  document_id uuid references public.business_documents(id) on delete set null,
  show_enquiry boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_hosted_profiles_updated_at on public.hosted_profiles;
create trigger set_hosted_profiles_updated_at before update on public.hosted_profiles
  for each row execute function public.set_updated_at();

-- Publishing is deliberate AND entitlement-gated; the linked document must
-- belong to the same workspace.
create or replace function public.hosted_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.document_id is not null and not exists (
    select 1 from public.business_documents where id = new.document_id and workspace_id = new.workspace_id
  ) then
    raise exception 'hosted_profiles.document_id must belong to the same workspace' using errcode = '23514';
  end if;
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    if not public.workspace_has_entitlement(new.workspace_id, 'hosted_profile.publish') then
      raise exception 'Publishing a hosted profile requires a Business or Growth subscription' using errcode = '42501';
    end if;
    new.published_at := now();
  end if;
  if not new.is_published then
    new.published_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists hosted_profiles_guard_trg on public.hosted_profiles;
create trigger hosted_profiles_guard_trg before insert or update on public.hosted_profiles
  for each row execute function public.hosted_profiles_guard();

-- Website monitoring -------------------------------------------------------------

create table if not exists public.website_monitors (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  url text not null check (url ~* '^https?://' and length(url) <= 500),
  enabled boolean not null default true,
  frequency_days integer not null default 7 check (frequency_days between 1 and 90),
  next_check_at timestamptz not null default (now() + interval '7 days'),
  last_checked_at timestamptz,
  last_scan_id uuid references public.website_scans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_website_monitors_updated_at on public.website_monitors;
create trigger set_website_monitors_updated_at before update on public.website_monitors
  for each row execute function public.set_updated_at();

create or replace function public.website_monitors_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.enabled and (tg_op = 'INSERT' or not old.enabled) and auth.role() is distinct from 'service_role' then
    if not public.workspace_has_entitlement(new.workspace_id, 'website_monitoring') then
      raise exception 'Website monitoring requires a Business or Growth subscription' using errcode = '42501';
    end if;
  end if;
  if auth.role() is distinct from 'service_role' then
    -- Clients choose url/frequency/enabled; scheduling fields are the tick's.
    if tg_op = 'UPDATE' then
      new.last_checked_at := old.last_checked_at;
      new.last_scan_id := old.last_scan_id;
    end if;
    new.next_check_at := coalesce(
      case when tg_op = 'UPDATE' and new.frequency_days = old.frequency_days then old.next_check_at end,
      now() + make_interval(days => new.frequency_days)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists website_monitors_guard_trg on public.website_monitors;
create trigger website_monitors_guard_trg before insert or update on public.website_monitors
  for each row execute function public.website_monitors_guard();

-- RLS ---------------------------------------------------------------------------------

alter table public.website_scans enable row level security;
alter table public.website_scan_pages enable row level security;
alter table public.business_fact_proposals enable row level security;
alter table public.profile_templates enable row level security;
alter table public.business_documents enable row level security;
alter table public.hosted_profiles enable row level security;
alter table public.website_monitors enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['website_scans', 'website_scan_pages', 'business_fact_proposals', 'business_documents', 'hosted_profiles', 'website_monitors']
  loop
    execute format('drop policy if exists "%1$s_select_member" on public.%1$I', t);
    execute format('create policy "%1$s_select_member" on public.%1$I for select to authenticated using (public.is_workspace_member(workspace_id))', t);
  end loop;
end
$$;

-- Scans, pages, documents: written only by edge functions (service role).
-- Proposals: status changes only through the accept/reject functions.
-- Hosted profiles and monitors: admin-editable, guarded by triggers above.
drop policy if exists "hosted_profiles_write_admin" on public.hosted_profiles;
create policy "hosted_profiles_write_admin" on public.hosted_profiles for all to authenticated
  using (public.has_workspace_role(workspace_id, 'admin'))
  with check (public.has_workspace_role(workspace_id, 'admin'));
drop policy if exists "website_monitors_write_admin" on public.website_monitors;
create policy "website_monitors_write_admin" on public.website_monitors for all to authenticated
  using (public.has_workspace_role(workspace_id, 'admin'))
  with check (public.has_workspace_role(workspace_id, 'admin'));

drop policy if exists "profile_templates_read_all" on public.profile_templates;
create policy "profile_templates_read_all" on public.profile_templates for select to anon, authenticated using (is_active);

-- Accept / reject a proposal --------------------------------------------------------

create or replace function public.accept_business_fact_proposal(p_proposal_id uuid, p_edited jsonb default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.business_fact_proposals;
  v jsonb;
  v_ref text;
  v_src text;
  v_identity public.business_identities;
begin
  select * into v_p from public.business_fact_proposals where id = p_proposal_id for update;
  if v_p.id is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if not public.has_workspace_role(v_p.workspace_id, 'admin') then
    raise exception 'Only workspace admins can review business facts' using errcode = '42501';
  end if;
  if v_p.status <> 'pending' then
    return 'already_' || v_p.status;
  end if;

  -- The customer may correct the value while accepting; keys are
  -- restricted to what the target allows below.
  v := coalesce(p_edited, v_p.proposed);
  v_src := case v_p.origin when 'ai_wording' then 'ai_suggestion' when 'document_upload' then 'document_upload' else 'website_scan' end;

  if v_p.target = 'identity_field' then
    if v_p.field not in ('legal_name', 'trading_name', 'industry', 'website', 'tagline', 'short_description', 'long_description', 'mission', 'vision', 'founded_year', 'core_values') then
      raise exception 'Field % cannot be set from a proposal', v_p.field using errcode = '22023';
    end if;
    select * into v_identity from public.business_identities where workspace_id = v_p.workspace_id for update;
    execute format(
      'update public.business_identities set %1$I = %2$s, field_provenance = field_provenance || jsonb_build_object(%3$L, jsonb_build_object(''source'', %4$L, ''source_ref'', %5$L, ''confirmed_at'', now())) where workspace_id = $1',
      v_p.field,
      case v_p.field
        when 'founded_year' then '($2->>''value'')::integer'
        when 'core_values' then 'coalesce((select array_agg(x) from jsonb_array_elements_text($2->''value'') x), ''{}'')'
        else '$2->>''value'''
      end,
      v_p.field, v_src, coalesce(v_p.evidence_url, v_p.origin)
    ) using v_p.workspace_id, v;
    v_ref := v_p.field;

  elsif v_p.target = 'contact' then
    insert into public.business_contacts (workspace_id, kind, value, label, is_primary, source, source_ref, verification_status, confirmed_by, confirmed_at)
    values (v_p.workspace_id, v->>'kind', v->>'value', v->>'label',
      not exists (select 1 from public.business_contacts c where c.workspace_id = v_p.workspace_id and c.kind = v->>'kind' and c.is_primary),
      v_src, v_p.evidence_url, 'user_confirmed', auth.uid(), now())
    returning id::text into v_ref;

  elsif v_p.target = 'location' then
    insert into public.business_locations (workspace_id, label, address_line1, city, region, postal_code, country_code, is_primary, source, source_ref, verification_status, confirmed_by, confirmed_at)
    values (v_p.workspace_id, v->>'label', v->>'address_line1', v->>'city', v->>'region', v->>'postal_code', nullif(upper(v->>'country_code'), ''),
      not exists (select 1 from public.business_locations l where l.workspace_id = v_p.workspace_id and l.is_primary),
      v_src, v_p.evidence_url, 'user_confirmed', auth.uid(), now())
    returning id::text into v_ref;

  elsif v_p.target = 'social_link' then
    insert into public.business_social_links (workspace_id, platform, url, source, source_ref, verification_status, confirmed_by, confirmed_at)
    values (v_p.workspace_id, v->>'platform', v->>'url', v_src, v_p.evidence_url, 'user_confirmed', auth.uid(), now())
    returning id::text into v_ref;

  elsif v_p.target = 'offering' then
    insert into public.business_offerings (workspace_id, kind, name, description, source, source_ref, verification_status, confirmed_by, confirmed_at)
    values (v_p.workspace_id, coalesce(v->>'kind', 'service'), v->>'name', v->>'description', v_src, v_p.evidence_url, 'user_confirmed', auth.uid(), now())
    returning id::text into v_ref;

  elsif v_p.target = 'team_member' then
    insert into public.business_team_members (workspace_id, full_name, role_title, source, source_ref, verification_status, confirmed_by, confirmed_at)
    values (v_p.workspace_id, v->>'full_name', v->>'role_title', v_src, v_p.evidence_url, 'user_confirmed', auth.uid(), now())
    returning id::text into v_ref;

  elsif v_p.target = 'project' then
    insert into public.business_projects (workspace_id, title, client_name, description, source, source_ref, verification_status, confirmed_by, confirmed_at)
    values (v_p.workspace_id, v->>'title', v->>'client_name', v->>'description', v_src, v_p.evidence_url, 'user_confirmed', auth.uid(), now())
    returning id::text into v_ref;

  elsif v_p.target = 'certification' then
    insert into public.business_certifications (workspace_id, name, issuer, source, source_ref, verification_status, confirmed_by, confirmed_at)
    values (v_p.workspace_id, v->>'name', v->>'issuer', v_src, v_p.evidence_url, 'user_confirmed', auth.uid(), now())
    returning id::text into v_ref;

  elsif v_p.target = 'identifier' then
    insert into public.business_identifiers (workspace_id, country_code, scheme, value, source, source_ref, verification_status, confirmed_by, confirmed_at)
    values (v_p.workspace_id, coalesce(nullif(upper(v->>'country_code'), ''), 'ZA'), v->>'scheme', v->>'value', v_src, v_p.evidence_url, 'user_confirmed', auth.uid(), now())
    on conflict (workspace_id, country_code, scheme) do update set value = excluded.value, source = excluded.source, source_ref = excluded.source_ref,
      verification_status = 'user_confirmed', confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at
    returning id::text into v_ref;
  end if;

  update public.business_fact_proposals
  set status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now(), applied_ref = v_ref,
      proposed = case when p_edited is not null then p_edited else proposed end
  where id = v_p.id;

  -- Another pending proposal for the same identity field is now moot.
  if v_p.target = 'identity_field' then
    update public.business_fact_proposals
    set status = 'superseded', reviewed_at = now()
    where workspace_id = v_p.workspace_id and target = 'identity_field' and field = v_p.field and status = 'pending' and id <> v_p.id;
  end if;
  return 'accepted';
end;
$$;

create or replace function public.reject_business_fact_proposal(p_proposal_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.business_fact_proposals;
begin
  select * into v_p from public.business_fact_proposals where id = p_proposal_id for update;
  if v_p.id is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if not public.has_workspace_role(v_p.workspace_id, 'admin') then
    raise exception 'Only workspace admins can review business facts' using errcode = '42501';
  end if;
  if v_p.status <> 'pending' then
    return 'already_' || v_p.status;
  end if;
  update public.business_fact_proposals set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now() where id = v_p.id;
  return 'rejected';
end;
$$;

revoke execute on function public.accept_business_fact_proposal(uuid, jsonb) from public, anon;
revoke execute on function public.reject_business_fact_proposal(uuid) from public, anon;
grant execute on function public.accept_business_fact_proposal(uuid, jsonb) to authenticated;
grant execute on function public.reject_business_fact_proposal(uuid) to authenticated;

-- Public hosted profile ----------------------------------------------------------------
-- The ONLY anonymous read path into business data. Returns public facts
-- only, only while published AND the workspace still holds the
-- hosted_profile.publish entitlement (a lapsed subscription unpublishes
-- implicitly, without deleting anything).

create or replace function public.get_public_business_profile(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hp public.hosted_profiles;
  v_i public.business_identities;
  v_bp public.creative_brand_profiles;
  v_logo text;
begin
  select * into v_hp from public.hosted_profiles where slug = lower(p_slug) and is_published;
  if v_hp.workspace_id is null then
    return null;
  end if;
  if not coalesce((select enabled from public._workspace_entitlements(v_hp.workspace_id) where entitlement_key = 'hosted_profile.publish'), false) then
    return null;
  end if;
  select * into v_i from public.business_identities where workspace_id = v_hp.workspace_id;
  select * into v_bp from public.creative_brand_profiles where id = v_i.brand_profile_id;
  select storage_path into v_logo from public.content_media_assets where id = v_bp.logo_media_asset_id;

  return jsonb_build_object(
    'slug', v_hp.slug,
    'template_key', v_hp.template_key,
    'show_enquiry', v_hp.show_enquiry,
    'has_document', v_hp.document_id is not null,
    'identity', jsonb_build_object(
      'name', coalesce(v_i.trading_name, v_i.legal_name),
      'legal_name', v_i.legal_name,
      'tagline', v_i.tagline,
      'short_description', v_i.short_description,
      'long_description', v_i.long_description,
      'mission', v_i.mission,
      'vision', v_i.vision,
      'core_values', to_jsonb(v_i.core_values),
      'industry', v_i.industry,
      'website', v_i.website,
      'founded_year', v_i.founded_year,
      'country_code', v_i.country_code
    ),
    'brand', case when v_bp.id is null then null else jsonb_build_object(
      'primary', v_bp.primary_color, 'secondary', v_bp.secondary_color, 'accent', v_bp.accent_color, 'has_logo', v_logo is not null
    ) end,
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'label', label, 'value', value) order by is_primary desc, sort_order)
      from public.business_contacts where workspace_id = v_hp.workspace_id and is_public and verification_status <> 'rejected'), '[]'),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'address_line1', address_line1, 'address_line2', address_line2, 'city', city, 'region', region, 'postal_code', postal_code) order by is_primary desc, sort_order)
      from public.business_locations where workspace_id = v_hp.workspace_id and is_public and verification_status <> 'rejected'), '[]'),
    'social_links', coalesce((select jsonb_agg(jsonb_build_object('platform', platform, 'url', url) order by sort_order)
      from public.business_social_links where workspace_id = v_hp.workspace_id and verification_status <> 'rejected'), '[]'),
    'offerings', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'name', name, 'description', description, 'price_text', price_text) order by is_featured desc, sort_order)
      from public.business_offerings where workspace_id = v_hp.workspace_id and verification_status <> 'rejected'), '[]'),
    'team', coalesce((select jsonb_agg(jsonb_build_object('full_name', full_name, 'role_title', role_title, 'bio', bio) order by sort_order)
      from public.business_team_members where workspace_id = v_hp.workspace_id and is_public and verification_status <> 'rejected'), '[]'),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'client_name', client_name, 'description', description, 'location', location, 'completed_year', completed_year) order by sort_order)
      from public.business_projects where workspace_id = v_hp.workspace_id and is_public and verification_status <> 'rejected'), '[]'),
    'certifications', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'issuer', issuer, 'expires_on', expires_on) order by sort_order)
      from public.business_certifications where workspace_id = v_hp.workspace_id and is_public and verification_status <> 'rejected'), '[]'),
    'identifiers', coalesce((select jsonb_agg(jsonb_build_object('scheme', scheme, 'country_code', country_code, 'value', value))
      from public.business_identifiers where workspace_id = v_hp.workspace_id and is_public and verification_status <> 'rejected'), '[]')
  );
end;
$$;

revoke execute on function public.get_public_business_profile(text) from public;
grant execute on function public.get_public_business_profile(text) to anon, authenticated;

create or replace function public.is_hosted_profile_slug_available(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.hosted_profiles where slug = lower(p_slug));
$$;
revoke execute on function public.is_hosted_profile_slug_available(text) from public, anon;
grant execute on function public.is_hosted_profile_slug_available(text) to authenticated;

-- Monitoring tick schedule (daily at 03:17 UTC). Same vault + pg_cron +
-- pg_net pattern; WEBSITE_MONITOR_CRON_SECRET must be set from vault
-- (website_monitor_cron_secret) as an uncommitted step.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'website_monitor_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'website_monitor_cron_secret');
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
  select jobid into v_job_id from cron.job where jobname = 'website-monitor-tick' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'website-monitor-tick',
    '17 3 * * *',
    $cron$
    select net.http_post(
      url := 'https://doarqrjpadejksovxeev.supabase.co/functions/v1/website-monitor-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'website_monitor_cron_secret')
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
