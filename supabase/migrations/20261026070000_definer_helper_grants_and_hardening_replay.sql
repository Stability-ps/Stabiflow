-- SECURITY DEFINER audit follow-up.
--
-- 1. Workspace helper functions are for signed-in users only.
--    has_workspace_permission, has_workspace_role, is_workspace_member,
--    can_grant_workspace_role and can_manage_member_with_role stayed
--    executable by anon (20261006133335 kept them for RLS). They answer only
--    about the caller (auth.uid()), so for anon they always return false and
--    nothing leaked - but no anon-applicable policy uses them (checked in
--    production: no policy for roles public/anon in public or storage calls
--    them; authenticated-only policies are never evaluated for anon), and no
--    anonymous code path calls them. Revoke from PUBLIC/anon; keep
--    authenticated (RLS) and service_role.
--    Deliberately unchanged: get_public_business_profile and
--    current_legal_versions (public profile/legal pages).
--
-- 2. Replay of earlier hardening for databases built from the repo.
--    20261006133335 (search_path pinning) and 20261002151000 (no API
--    EXECUTE on SECURITY DEFINER trigger functions) ran in production after
--    the functions they target existed, but on a fresh database several of
--    those functions are created by later-dated migrations, so the earlier
--    files miss them. Re-applying both idempotently here makes a fresh
--    database match production. On production this part changes nothing.

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'has_workspace_permission', 'has_workspace_role', 'is_workspace_member',
        'can_grant_workspace_role', 'can_manage_member_with_role'
      ])
  loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;

  for fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        '_admin_like', 'billing_interval_to_interval',
        'billing_prices_immutable_terms', 'business_fact_source_valid',
        'business_fact_verification_valid', 'content_storage_path_workspace_id',
        'feature_flag_bucket', 'inbox_storage_path_workspace_id',
        'legal_documents_immutable_published', 'normalize_phone_number',
        'platform_admin_audit_append_only', 'workspace_assets_path_workspace_id',
        'workspace_role_rank'
      ])
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', fn);
  end loop;

  for fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from anon, authenticated, public', fn);
  end loop;
end
$$;
