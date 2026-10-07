-- Plan/module access for direct Data API writes.
--
-- The UI (FeatureGate) and the module edge functions check the workspace's
-- plan, but RLS only checks role permissions, so a Free workspace could
-- insert leads, automations, content series, integration rows, etc. straight
-- through the Data API (verified in production in a rolled-back
-- transaction). This adds one BEFORE INSERT OR UPDATE trigger per
-- module-owned table that refuses the write when the module is off.
--
-- Scope, deliberately narrow:
-- - Only direct client writes are checked (current_user authenticated/anon).
--   The service role (edge functions, which check plans in code) and
--   SECURITY DEFINER functions (create_workspace's default pipeline, the
--   webhook/SLA helpers), which run as their owner, are unaffected.
-- - INSERT and UPDATE are refused; SELECT (and so export) and DELETE are
--   untouched, so a downgraded workspace keeps its data and can remove it.
-- - Shared tables that Free screens write are NOT gated: creative brand
--   profiles and content media (My Business brand kit), business_* (My
--   Business), hosted profiles / website monitors (already entitlement-
--   guarded), workspace settings, members, invitations, profiles,
--   notifications, guide feedback, activity log. whatsapp_template_favorites
--   is per user with no workspace, so it cannot be gated per workspace.
-- - No existing policy is changed; rollback is dropping the triggers.

create or replace function public.workspace_module_enabled(p_workspace_id uuid, p_flag_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Unlike is_feature_enabled this never raises for a non-member; RLS is
  -- what refuses non-members, this only answers "is the module on".
  if p_workspace_id is null then
    return false;
  end if;
  if auth.role() is distinct from 'service_role'
     and not public.is_platform_operator()
     and not public.is_workspace_member(p_workspace_id) then
    return false;
  end if;
  return coalesce((select f.enabled from public.evaluate_feature_flags(p_workspace_id) f where f.flag_key = p_flag_key), false);
end;
$$;

revoke execute on function public.workspace_module_enabled(uuid, text) from public, anon;
grant execute on function public.workspace_module_enabled(uuid, text) to authenticated, service_role;

-- TG_ARGV[0] = module flag key, TG_ARGV[1] = customer-facing message.
-- SECURITY INVOKER on purpose: current_user must be the writing role.
create or replace function public.enforce_workspace_module()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_table_name = 'inbox_conversation_reads' then
    select c.workspace_id into v_workspace_id from public.inbox_conversations c where c.id = new.conversation_id;
  else
    v_workspace_id := new.workspace_id;
  end if;

  if not public.workspace_module_enabled(v_workspace_id, tg_argv[0]) then
    raise exception '%', tg_argv[1] using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_workspace_module() from public, anon, authenticated;

do $$
declare
  r record;
  messages constant jsonb := jsonb_build_object(
    'module.leads', 'Leads are part of the Business and Growth plans. Upgrade in Billing & plans to use them.',
    'module.customers', 'Customers are part of the Business and Growth plans. Upgrade in Billing & plans to use them.',
    'module.campaigns', 'Campaigns are part of the Growth plan. Upgrade in Billing & plans to use them.',
    'module.content', 'Content is part of the Business and Growth plans. Upgrade in Billing & plans to use it.',
    'module.creative_studio', 'Creative Studio is part of the Growth plan. Upgrade in Billing & plans to use it.',
    'module.automations', 'Automations are part of the Growth plan. Upgrade in Billing & plans to use them.',
    'module.whatsapp', 'WhatsApp is part of the Growth plan. Upgrade in Billing & plans to use it.',
    'module.integrations', 'Integrations are part of the Growth plan. Upgrade in Billing & plans to use them.',
    'module.flow_ai', 'Flow AI is part of the Growth plan. Upgrade in Billing & plans to use it.'
  );
begin
  for r in
    select * from (values
      ('leads', 'module.leads'), ('opportunities', 'module.leads'), ('crm_notes', 'module.leads'),
      ('pipelines', 'module.leads'), ('pipeline_stages', 'module.leads'),
      ('revenue_events', 'module.customers'),
      ('attribution_events', 'module.campaigns'), ('campaign_entry_tokens', 'module.campaigns'),
      ('ad_campaigns', 'module.campaigns'), ('ad_creatives', 'module.campaigns'),
      ('content_scheduled_posts', 'module.content'), ('content_series', 'module.content'),
      ('content_series_items', 'module.content'), ('content_series_excluded_dates', 'module.content'),
      ('content_platform_variants', 'module.content'), ('content_publish_attempts', 'module.content'),
      ('creative_studio_batches', 'module.creative_studio'), ('creative_studio_concepts', 'module.creative_studio'),
      ('creative_studio_creatives', 'module.creative_studio'),
      ('automations', 'module.automations'), ('automation_actions', 'module.automations'),
      ('automation_conditions', 'module.automations'),
      ('inbox_conversations', 'module.whatsapp'), ('inbox_alerts', 'module.whatsapp'),
      ('inbox_internal_notes', 'module.whatsapp'), ('inbox_conversation_reads', 'module.whatsapp'),
      ('workspace_business_hours', 'module.whatsapp'),
      ('workspace_integrations', 'module.integrations'), ('workspace_whatsapp_numbers', 'module.integrations'),
      ('workspace_facebook_pages', 'module.integrations'), ('workspace_instagram_accounts', 'module.integrations'),
      ('workspace_meta_ad_accounts', 'module.integrations'),
      ('ai_conversations', 'module.flow_ai')
    ) as v(tbl, flag)
  loop
    execute format('drop trigger if exists enforce_module_plan_trg on public.%I', r.tbl);
    execute format(
      'create trigger enforce_module_plan_trg before insert or update on public.%I for each row execute function public.enforce_workspace_module(%L, %L)',
      r.tbl, r.flag, messages ->> r.flag
    );
  end loop;
end;
$$;
