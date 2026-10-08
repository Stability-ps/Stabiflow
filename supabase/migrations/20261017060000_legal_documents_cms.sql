-- Pages & Legal: versioned, admin-published legal documents.
--
-- Extends (does not replace) 20261004060000_legal_acceptance_tracking.sql:
--  * legal_document_versions stays the single DB-authoritative "current
--    version" pointer that accept_current_legal_terms() reads. Publishing a
--    new Privacy Policy / Terms version through publish_legal_document()
--    moves that pointer atomically, so acceptance evidence always refers
--    to the version actually published.
--  * legal_documents holds the text of every version (draft -> published ->
--    superseded) with effective date, change summary and who published it:
--    the publication history. Published versions are public; drafts are
--    service-role only (written through the audited operator-admin
--    function).
--  * Until a document type has a published version, the frontend keeps
--    rendering the existing in-code page, so nothing changes for visitors
--    until the owner deliberately publishes.
--  * Users who accepted an OLDER Privacy/Terms version can re-accept the
--    current one (source 'reconsent') - the signup-only RPC is unchanged.
-- ---------------------------------------------------------------------------

create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in (
    'privacy_policy', 'terms_of_service', 'cookie_policy', 'refund_policy', 'subscription_terms', 'ai_data_disclosure', 'data_deletion'
  )),
  version text not null check (version ~ '^[0-9A-Za-z._-]{1,40}$'),
  title text not null check (length(trim(title)) between 1 and 200),
  -- Limited markdown (## headings, paragraphs, "- " bullets, **bold**,
  -- [text](https://...) links). Rendered by the frontend into React
  -- elements - never injected as HTML.
  body text not null check (length(body) between 1 and 200000),
  change_summary text check (change_summary is null or length(change_summary) <= 1000),
  effective_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  created_by uuid references public.profiles(id) on delete set null,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_type, version)
);

create unique index if not exists legal_documents_one_published
  on public.legal_documents (document_type) where status = 'published';

drop trigger if exists set_legal_documents_updated_at on public.legal_documents;
create trigger set_legal_documents_updated_at before update on public.legal_documents
  for each row execute function public.set_updated_at();

-- Published text is immutable: a correction is a new version.
create or replace function public.legal_documents_immutable_published()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft' and (
    new.body is distinct from old.body or new.title is distinct from old.title
    or new.version is distinct from old.version or new.effective_at is distinct from old.effective_at
    or new.document_type is distinct from old.document_type
  ) then
    raise exception 'Published legal documents cannot be edited - publish a new version' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists legal_documents_immutable_published_trg on public.legal_documents;
create trigger legal_documents_immutable_published_trg before update on public.legal_documents
  for each row execute function public.legal_documents_immutable_published();

alter table public.legal_documents enable row level security;
drop policy if exists "legal_documents_read_published" on public.legal_documents;
create policy "legal_documents_read_published" on public.legal_documents for select to anon, authenticated
  using (status in ('published', 'superseded'));

-- Publish a draft: supersede the previous published version and, for the
-- two acceptance-tracked documents, move the current-version pointer. One
-- transaction, service role only.
create or replace function public.publish_legal_document(p_document_id uuid, p_operator_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.legal_documents;
begin
  select * into v_doc from public.legal_documents where id = p_document_id for update;
  if v_doc.id is null then
    raise exception 'Legal document not found' using errcode = 'P0002';
  end if;
  if v_doc.status <> 'draft' then
    return 'already_' || v_doc.status;
  end if;

  update public.legal_documents set status = 'superseded'
  where document_type = v_doc.document_type and status = 'published';

  update public.legal_documents
  set status = 'published', published_at = now(), published_by = p_operator_id
  where id = v_doc.id;

  if v_doc.document_type in ('privacy_policy', 'terms_of_service') then
    insert into public.legal_document_versions (document_type, current_version, effective_at, updated_at)
    values (v_doc.document_type, v_doc.version, v_doc.effective_at, now())
    on conflict (document_type) do update
      set current_version = excluded.current_version, effective_at = excluded.effective_at, updated_at = now();
  end if;
  return 'published';
end;
$$;

revoke execute on function public.publish_legal_document(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_legal_document(uuid, uuid) to service_role;

-- Current tracked versions, readable by anyone (the pages show them; the
-- values themselves are not sensitive - only WRITING them is restricted).
create or replace function public.current_legal_versions()
returns table (document_type text, current_version text, effective_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select document_type, current_version, effective_at from public.legal_document_versions;
$$;
grant execute on function public.current_legal_versions() to anon, authenticated;

-- Has the CALLING user accepted the current Privacy + Terms versions?
-- 'current' = accepted both; 'outdated' = accepted an earlier version of
-- at least one (needs re-consent); 'none' = no acceptance evidence at all
-- (pre-tracking accounts - not forced through re-consent).
create or replace function public.my_legal_acceptance_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then 'none'
    when not exists (select 1 from public.legal_acceptances where user_id = auth.uid()) then 'none'
    when (
      select count(*) from public.legal_document_versions v
      where v.document_type in ('privacy_policy', 'terms_of_service')
        and exists (select 1 from public.legal_acceptances a where a.user_id = auth.uid() and a.document_type = v.document_type and a.document_version = v.current_version)
    ) = 2 then 'current'
    else 'outdated'
  end;
$$;
revoke execute on function public.my_legal_acceptance_status() from public, anon;
grant execute on function public.my_legal_acceptance_status() to authenticated;

-- Re-consent after a new version is published. Same guarantees as
-- accept_current_legal_terms(): user from auth.uid(), versions from the DB.
create or replace function public.reaccept_current_legal_terms()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  insert into public.legal_acceptances (user_id, document_type, document_version, source, policy_url)
  select v_user, v.document_type, v.current_version, 'reconsent',
         case v.document_type when 'privacy_policy' then '/legal/privacy' else '/legal/terms' end
  from public.legal_document_versions v
  where v.document_type in ('privacy_policy', 'terms_of_service')
  on conflict (user_id, document_type, document_version) do nothing;
  return 'accepted';
end;
$$;
revoke execute on function public.reaccept_current_legal_terms() from public, anon;
grant execute on function public.reaccept_current_legal_terms() to authenticated;

-- Acceptance counts per version (Admin). Service role only.
create or replace function public.legal_acceptance_stats()
returns table (document_type text, document_version text, acceptances bigint, last_accepted_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.document_type, a.document_version, count(*), max(a.accepted_at)
  from public.legal_acceptances a
  group by a.document_type, a.document_version
  order by a.document_type, max(a.accepted_at) desc;
$$;
revoke execute on function public.legal_acceptance_stats() from public, anon, authenticated;
grant execute on function public.legal_acceptance_stats() to service_role;
