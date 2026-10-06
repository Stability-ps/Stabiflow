-- Plan cards must match who actually gets Automations: module.automations is
-- enabled for Growth (and Pro) only. Edits individual feature lines in place,
-- so any other copy changed from Admin is preserved. Idempotent.

-- Business no longer advertises automation runs it cannot use.
update public.billing_plans
set marketing = jsonb_set(
      marketing,
      '{features}',
      coalesce((select jsonb_agg(f) from jsonb_array_elements(marketing->'features') f
                where f #>> '{}' not ilike '%automation runs%'), '[]'::jsonb)
    ),
    updated_at = now()
where code = 'business'
  and marketing->'features' @> '["500 automation runs / month"]'::jsonb;

-- Free and Professional Profile point to the plan that includes Automations.
update public.billing_plans
set marketing = jsonb_set(
      marketing,
      '{features}',
      (select jsonb_agg(case when f #>> '{}' = 'Automations require a subscription'
                             then to_jsonb('Automations require the Growth plan'::text) else f end)
       from jsonb_array_elements(marketing->'features') f)
    ),
    updated_at = now()
where code in ('free', 'profile_once')
  and marketing->'features' @> '["Automations require a subscription"]'::jsonb;
