-- Commercial usage guardrails for the paid StabiFlow plans.
--
-- Keep customer-facing allowances predictable while preventing API-heavy
-- features from becoming an unbounded cost centre. These are monthly
-- entitlements enforced through the existing canonical allowance counter.
-- AI token ceilings remain enforced by the existing ai_usage_events gates;
-- this migration gives each paid tier a conservative platform allowance
-- that can be surfaced/administered alongside the rest of Billing.

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
  ('business', 'creative_generations', 0::bigint),
  ('business', 'automation_runs', 0::bigint),
  ('business', 'whatsapp_ai_turns', 0::bigint),
  ('growth', 'creative_generations', 100::bigint),
  ('growth', 'automation_runs', 1000::bigint),
  ('growth', 'whatsapp_ai_turns', 500::bigint)
) as v(plan_code, entitlement_key, limit_value) on v.plan_code = p.code
on conflict (plan_id, entitlement_key) do update set limit_value = excluded.limit_value;

-- Plan-aware AI token caps. workspace_billing.limits is already protected
-- from tenant writes. This helper lets costly server-side functions derive
-- a safe monthly ceiling without trusting browser input. Explicit operator
-- limits still win when present.
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
    return case when p_feature = 'flow_ai' then 500000 else 500000 end;
  elsif 'business' = any(v_codes) then
    return case when p_feature = 'flow_ai' then 100000 else 50000 end;
  else
    return case when p_feature = 'flow_ai' then 25000 else 10000 end;
  end if;
end;
$$;

revoke execute on function public.workspace_ai_token_cap(uuid, text) from public, anon;
grant execute on function public.workspace_ai_token_cap(uuid, text) to authenticated, service_role;

comment on function public.workspace_ai_token_cap(uuid, text) is
  'Returns the operator override when set, otherwise a conservative plan-aware monthly AI token ceiling.';
