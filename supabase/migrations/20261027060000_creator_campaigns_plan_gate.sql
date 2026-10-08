-- Creator Campaigns (20261026060000) shipped one migration after the
-- direct-write plan gate (20261025060000_enforce_module_plan_on_direct_writes),
-- so its two tables never got enforce_module_plan_trg: a workspace without
-- Analytics could still INSERT/UPDATE them through the Data API even though
-- the only UI for them lives behind the module.analytics route gate.
--
-- Same trigger, same semantics as every other module table: the workspace's
-- own users cannot insert/update while the module is off (42501), can still
-- read and delete; service-role and SECURITY DEFINER writes are unaffected.
do $$
declare
  msg constant text := 'Analytics is part of the Growth plan. Upgrade in Billing & plans to use it.';
  t text;
begin
  foreach t in array array['creator_campaigns', 'creator_campaign_posts'] loop
    execute format('drop trigger if exists enforce_module_plan_trg on public.%I', t);
    execute format(
      'create trigger enforce_module_plan_trg before insert or update on public.%I for each row execute function public.enforce_workspace_module(%L, %L)',
      t, 'module.analytics', msg
    );
  end loop;
end;
$$;
