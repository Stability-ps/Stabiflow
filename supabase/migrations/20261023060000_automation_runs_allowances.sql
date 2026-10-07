-- Automation run allowances: one answer everywhere.
--
-- Automations are a Growth (and Pro) module: module.automations targets
-- growth/pro and automations-tick refuses workspaces without that flag.
-- The Business plan still carried a 500-run allowance, which Billing showed
-- as "automation runs 0/500" for a feature Business can't use.
--
-- Also aligns a fresh database with production (where these values were set
-- from Admin): Free 0 runs, Growth 2,000 runs - the figure on the Growth
-- plan card. Idempotent; touches only automation_runs rows.
update public.plan_entitlements pe
set limit_value = v.runs
from public.billing_plans p
join (values ('free', 0::bigint), ('business', 0::bigint), ('growth', 2000::bigint)) as v(code, runs) on v.code = p.code
where p.id = pe.plan_id
  and pe.entitlement_key = 'automation_runs'
  and pe.limit_value is distinct from v.runs;
