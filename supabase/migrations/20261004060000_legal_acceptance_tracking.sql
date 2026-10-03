-- Launch-readiness: durable Privacy/Terms acceptance tracking.
--
-- The signup checkbox (Signup.tsx) has always gated account creation, but
-- gates it client-side only - nothing durable recorded WHO accepted, WHEN,
-- or WHICH document version. This migration adds that evidence trail
-- without touching the checkbox itself or any legal wording.
--
-- Two tables:
--   legal_document_versions - tiny, DB-authoritative "what is current
--     right now" reference. The browser never supplies a version string to
--     be recorded; the RPC below always reads it from here. Not readable by
--     any client role - only the SECURITY DEFINER RPC (owner-bypass) sees
--     it, so there's exactly one place a version can be forged from: this
--     table, which only a migration can write.
--   legal_acceptances - append-only evidence. One row per
--     (user, document, version) a user has ever accepted. No client role
--     may INSERT/UPDATE/DELETE it directly (no grants for those, in
--     addition to RLS) - every write goes through accept_current_legal_
--     terms(), which derives the user from auth.uid() (never a client-
--     supplied user_id) and the version from legal_document_versions
--     (never a client-supplied version string).
--
-- Deliberately NOT built here (out of scope for this migration):
--   - re-consent workflows / forcing existing users through acceptance
--   - a policy editor/CMS (legal_document_versions is migration-seeded only)
--   - retention/purge of acceptance rows (this IS the audit evidence)
--   - historical backfill for users who signed up before this existed -
--     they get no acceptance row, because there is no genuine evidence
--     they accepted a specific version at a specific time.

-- legal_document_versions ----------------------------------------------------

create table if not exists public.legal_document_versions (
  document_type text primary key check (document_type in ('privacy_policy', 'terms_of_service')),
  current_version text not null,
  effective_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.legal_document_versions enable row level security;
-- No policies, no grants to anon/authenticated: this table is read only by
-- the SECURITY DEFINER RPC below (table owner bypasses RLS). Updating the
-- current version is a migration-only operation, matching "no policy
-- editor/CMS" above.
revoke all on public.legal_document_versions from anon, authenticated;

-- Seed the versions already live on the deployed legal pages today. Keep
-- this in sync with src/lib/legalDocuments.ts if either changes.
insert into public.legal_document_versions (document_type, current_version, effective_at) values
  ('privacy_policy', '2026-09-04', '2026-09-04T00:00:00Z'),
  ('terms_of_service', '2026-08-28', '2026-08-28T00:00:00Z')
on conflict (document_type) do nothing;

-- legal_acceptances -----------------------------------------------------------

create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Acceptance is a user-level fact (one person, one Terms/Privacy
  -- relationship with StabiFlow), not a per-workspace one - deliberately
  -- nullable and ON DELETE SET NULL so deleting a workspace never deletes
  -- (or is ever the trigger for deleting) a user's acceptance evidence.
  workspace_id uuid references public.workspaces(id) on delete set null,
  document_type text not null check (document_type in ('privacy_policy', 'terms_of_service')),
  document_version text not null,
  accepted_at timestamptz not null default now(),
  source text not null default 'signup' check (source in ('signup', 'reconsent', 'admin_import')),
  policy_url text,
  created_at timestamptz not null default now(),
  -- One durable row per (user, document, version): a replayed accept call
  -- (retry after a dropped response, a second login before the "already
  -- recorded" flag is cleared) is a no-op, never a duplicate.
  unique (user_id, document_type, document_version)
);

create index if not exists legal_acceptances_user_accepted_at_idx
  on public.legal_acceptances (user_id, accepted_at desc);

alter table public.legal_acceptances enable row level security;

-- Read: a user may see their own acceptance history (Account settings), and
-- nothing else. No workspace-scoped read policy - this is not a
-- workspace-permission-gated resource, it's personal evidence.
create policy legal_acceptances_select_own on public.legal_acceptances
  for select using (user_id = auth.uid());

-- Write: intentionally NO insert/update/delete policy, and no grant of
-- those privileges to authenticated/anon below - so even a caller who
-- somehow got past RLS would still be refused at the privilege-check layer
-- (defense in depth, same shape as the workspace_whatsapp_webhook_events
-- ledger). The only writer is accept_current_legal_terms() (SECURITY
-- DEFINER, owned by the migration role, which bypasses both).
grant select on public.legal_acceptances to authenticated;
revoke insert, update, delete on public.legal_acceptances from authenticated, anon;

comment on table public.legal_acceptances is
  'Append-only evidence that a user accepted a specific Privacy Policy / Terms of Service version at a specific server time. Written only by accept_current_legal_terms(). Never backfilled for pre-existing users.';

-- accept_current_legal_terms() -----------------------------------------------

create or replace function public.accept_current_legal_terms()
returns table (document_type text, document_version text, accepted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
-- RETURNS TABLE(document_type, document_version, accepted_at) implicitly
-- declares PL/pgSQL variables with those exact names - identical to the
-- legal_acceptances column names this function queries. Without this
-- directive, Postgres raises "column reference ... is ambiguous" even on
-- qualified references (e.g. inside ON CONFLICT's column list). This tells
-- it to always prefer the table column, which is what every reference
-- below actually means.
declare
  v_user_id uuid := auth.uid();
  v_privacy_version text;
  v_terms_version text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select ldv.current_version into v_privacy_version
    from public.legal_document_versions ldv where ldv.document_type = 'privacy_policy';
  select ldv.current_version into v_terms_version
    from public.legal_document_versions ldv where ldv.document_type = 'terms_of_service';

  if v_privacy_version is null or v_terms_version is null then
    raise exception 'Legal document versions are not configured';
  end if;

  -- Both inserts happen inside this one function call, so they succeed or
  -- fail together (Postgres function bodies are transactional) - a caller
  -- never ends up with only one of the two recorded. Re-calling this for a
  -- user who already accepted the current versions is a safe no-op.
  insert into public.legal_acceptances (user_id, document_type, document_version, source)
  values
    (v_user_id, 'privacy_policy', v_privacy_version, 'signup'),
    (v_user_id, 'terms_of_service', v_terms_version, 'signup')
  on conflict (user_id, document_type, document_version) do nothing;

  return query
    select la.document_type, la.document_version, la.accepted_at
    from public.legal_acceptances la
    where la.user_id = v_user_id
      and ((la.document_type = 'privacy_policy' and la.document_version = v_privacy_version)
        or (la.document_type = 'terms_of_service' and la.document_version = v_terms_version));
end;
$$;

revoke all on function public.accept_current_legal_terms() from public;
grant execute on function public.accept_current_legal_terms() to authenticated;

comment on function public.accept_current_legal_terms() is
  'Records the CALLING user (auth.uid(), never client-supplied) as having accepted the CURRENT Privacy Policy + Terms of Service versions (read from legal_document_versions, never client-supplied) at the server clock. Idempotent per (user, document, version). Takes no arguments - a caller cannot forge a version or another user''s acceptance.';
