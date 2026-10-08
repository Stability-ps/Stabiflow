-- Paid analytics follow the plan on READ as well as write.
--
-- Product policy (2026-10-08): when a workspace downgrades, its historical
-- data is preserved, but the paid analytics built on it are not available
-- until it upgrades again. Until now these SECURITY DEFINER read models
-- only checked membership, so a downgraded workspace could keep calling
-- them through the Data API even though their screens are plan-gated.
--
-- Each function keeps its exact signature and behaviour: the original is
-- renamed to _<name>_ungated (API execute revoked) and a same-named wrapper
-- checks the plan for workspace MEMBERS before delegating. Non-members are
-- delegated unchanged, so they keep getting the original's own
-- not-authorized error (no new information is revealed about a workspace's
-- plan). Service-role callers are unaffected. No rows are touched.
--
-- Deliberately NOT gated: get_analytics_kpis - Home's baseline counts
-- (conversations, qualified leads, customers) use it on every plan, and
-- each Home tile already shows its own plan-locked state.
do $$
declare
  analytics constant text := 'Analytics is part of the Growth plan. Upgrade in Billing & plans to use it.';
  whatsapp constant text := 'WhatsApp is part of the Growth plan. Upgrade in Billing & plans to use it.';
  spec record;
  fn record;
  impl text;
  arg_names text;
  cond text;
begin
  for spec in
    select * from (values
      ('get_creative_performance',           array['module.analytics'],                     analytics),
      ('get_lead_source_breakdown',          array['module.analytics'],                     analytics),
      ('get_whatsapp_analytics',             array['module.analytics'],                     analytics),
      ('get_revenue_breakdown',              array['module.analytics'],                     analytics),
      -- campaign read models also power the Campaigns module itself
      ('get_campaign_performance',           array['module.analytics', 'module.campaigns'], analytics),
      ('get_campaign_journey',               array['module.analytics', 'module.campaigns'], analytics),
      ('get_campaign_journey_entities',      array['module.analytics', 'module.campaigns'], analytics),
      ('get_campaign_conversion_counts',     array['module.analytics', 'module.campaigns'], analytics),
      ('get_whatsapp_operational_analytics', array['module.whatsapp'],                      whatsapp)
    ) as v(name, flags, msg)
  loop
    impl := '_' || spec.name || '_ungated';
    if to_regproc('public.' || impl) is not null then
      continue; -- already wrapped (idempotent re-run)
    end if;

    select p.oid, pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as ident,
           pg_get_function_result(p.oid) as result, p.proargnames
      into fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = spec.name;
    if fn.oid is null then
      raise exception 'gate_paid_analytics_reads: public.% not found', spec.name;
    end if;

    select string_agg(quote_ident(a), ', ' order by i) into arg_names
      from unnest(fn.proargnames) with ordinality as t(a, i)
     where i <= (select pronargs from pg_proc where oid = fn.oid);

    select string_agg(format('public.workspace_module_enabled(p_workspace_id, %L)', f), ' or ') into cond
      from unnest(spec.flags) as f;

    execute format('alter function public.%I(%s) rename to %I', spec.name, fn.ident, impl);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', impl, fn.ident);
    execute format('grant execute on function public.%I(%s) to service_role', impl, fn.ident);

    execute format($f$
      create function public.%1$I(%2$s)
      returns %3$s
      language plpgsql
      stable
      security definer
      set search_path = ''
      as $body$
      begin
        if auth.role() is distinct from 'service_role'
           and public.is_workspace_member(p_workspace_id)
           and not (%4$s) then
          raise exception '%%', %5$L using errcode = '42501';
        end if;
        return query select * from public.%6$I(%7$s);
      end;
      $body$
    $f$, spec.name, fn.args, fn.result, cond, spec.msg, impl, arg_names);

    execute format('revoke all on function public.%I(%s) from public, anon', spec.name, fn.ident);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', spec.name, fn.ident);
    execute format('comment on function public.%I(%s) is %L', spec.name, fn.ident,
      'Plan-gated wrapper (20261027080000) around ' || impl || ': members need ' || array_to_string(spec.flags, ' or ') || '.');
  end loop;
end;
$$;

-- Creator Campaigns live under Analytics: rows are kept on downgrade, but
-- read access follows the plan (writes were gated in 20261027060000).
drop policy if exists "creator campaigns view" on public.creator_campaigns;
create policy "creator campaigns view" on public.creator_campaigns for select to authenticated
  using (public.has_workspace_permission(workspace_id, 'view_analytics') and public.workspace_module_enabled(workspace_id, 'module.analytics'));

drop policy if exists "creator posts view" on public.creator_campaign_posts;
create policy "creator posts view" on public.creator_campaign_posts for select to authenticated
  using (public.has_workspace_permission(workspace_id, 'view_analytics') and public.workspace_module_enabled(workspace_id, 'module.analytics'));
