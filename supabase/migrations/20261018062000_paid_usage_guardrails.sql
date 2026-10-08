-- Commercial usage guardrails for paid plans.

insert into public.entitlement_definitions (key, name, description, kind, unit, reset_period, sort_order)
values
  ('creative_generations', 'Creative generations', 'AI-assisted Creative Studio generation requests per month.', 'allowance', 'generations', 'month', 80),
  ('automation_runs', 'Automation runs', 'Automation executions per month.', 'allowance', 'runs', 'month', 90),
  ('whatsapp_ai_turns', 'WhatsApp AI replies', 'AI-assisted WhatsApp reply turns per month.', 'allowance', 'AI replies', 'month', 100)
on conflict (key) do nothing;

insert into public.plan_entitlements (plan_id, entitlement_key, bool_value, limit_value)
select p.id, v.entitlement_key, null::boolean, v.limit_value
from public.billing_plans p
join (values
  ('free', 'creative_generations', 10::bigint),
  ('free', 'automation_runs', 100::bigint),
  ('free', 'whatsapp_ai_turns', 50::bigint),
  ('business', 'creative_generations', 0::bigint),
  ('business', 'automation_runs', 0::bigint),
  ('business', 'whatsapp_ai_turns', 0::bigint),
  ('growth', 'creative_generations', 100::bigint),
  ('growth', 'automation_runs', 1000::bigint),
  ('growth', 'whatsapp_ai_turns', 500::bigint)
) as v(plan_code, entitlement_key, limit_value) on v.plan_code = p.code
on conflict (plan_id, entitlement_key) do update set limit_value = excluded.limit_value;

create or replace function public.workspace_ai_token_cap(p_workspace_id uuid, p_feature text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_explicit bigint;
  v_codes text[];
begin
  if auth.role() is distinct from 'service_role'
     and not public.is_platform_operator()
     and not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not authorized for this workspace' using errcode = '42501';
  end if;

  if p_feature not in ('flow_ai', 'whatsapp_inbox_ai') then
    raise exception 'Unknown AI feature' using errcode = '22023';
  end if;

  select case
    when p_feature = 'flow_ai' then nullif(limits ->> 'flow_ai_monthly_token_limit', '')::bigint
    else nullif(limits ->> 'whatsapp_inbox_ai_monthly_token_limit', '')::bigint
  end
  into v_explicit
  from public.workspace_billing
  where workspace_id = p_workspace_id;

  if v_explicit is not null then return v_explicit; end if;

  v_codes := public.workspace_plan_codes(p_workspace_id);

  if 'growth' = any(v_codes) or 'pro' = any(v_codes) then
    return 500000;
  elsif 'business' = any(v_codes) then
    return case when p_feature = 'flow_ai' then 100000 else 50000 end;
  else
    return 500000;
  end if;
end;
$$;

revoke execute on function public.workspace_ai_token_cap(uuid, text) from public, anon;
grant execute on function public.workspace_ai_token_cap(uuid, text) to authenticated, service_role;

alter table public.automation_runs drop constraint if exists automation_runs_status_check;
alter table public.automation_runs
  add constraint automation_runs_status_check
  check (status in (
    'pending','in_progress','succeeded','partial','failed',
    'skipped_conditions_not_met','blocked_permission','blocked_usage_limit'
  ));
