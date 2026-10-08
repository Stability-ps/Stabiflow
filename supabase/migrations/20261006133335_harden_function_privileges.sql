-- Database function hardening (Supabase security advisor findings).
--
-- 1. SECURITY DEFINER functions that only make sense for a signed-in user
--    were executable by `anon` (via the default PUBLIC grant). They all
--    check membership internally, so nothing leaked, but an anonymous
--    caller should not reach them at all. Revoke from PUBLIC/anon and keep
--    an explicit grant for authenticated + service_role.
--    Deliberately NOT changed (anon must keep EXECUTE):
--      * RLS helpers used inside policies (has_workspace_permission,
--        has_workspace_role, is_workspace_member, can_grant_workspace_role,
--        can_manage_member_with_role) - revoking them would make anon
--        queries error instead of returning no rows;
--      * get_public_business_profile, current_legal_versions - public pages.
--
-- 2. next_lead_reference(p_workspace_id) had NO caller check and was
--    executable by anon and authenticated, so anyone with the public API key
--    could advance any workspace's lead counter. Its only legitimate caller
--    is the SECURITY DEFINER leads trigger (runs as owner), so it becomes
--    owner/service_role only.
--
-- 3. Pin search_path on functions flagged "function_search_path_mutable".
--    The value matches the default role search_path, so name resolution is
--    unchanged; it just can no longer be hijacked by a caller's setting.
--
-- Functions are matched by name (all overloads) so this applies whatever the
-- current signature is.

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'accept_current_legal_terms', 'accept_workspace_invitation',
        'ai_list_campaigns', 'ai_list_content', 'ai_list_customers',
        'ai_list_integrations', 'ai_list_leads', 'ai_list_opportunities',
        'create_workspace', 'customer_360', 'customer_match_candidates',
        'customers_search', 'ensure_default_pipeline', 'get_analytics_kpis',
        'get_campaign_conversion_counts', 'get_campaign_journey',
        'get_campaign_journey_entities', 'get_campaign_performance',
        'get_creative_performance', 'get_inbox_conversations',
        'get_lead_source_breakdown', 'get_recent_whatsapp_webhook_events',
        'get_revenue_breakdown', 'get_touch_summary', 'get_whatsapp_analytics',
        'get_whatsapp_operational_analytics'
      ])
  loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;

  for fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'next_lead_reference'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
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
end
$$;
