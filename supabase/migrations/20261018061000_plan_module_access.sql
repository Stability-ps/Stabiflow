-- Map paid plans to the modules they advertise.
-- Existing workspace targets still take precedence, preserving grandfathered access.

update public.feature_flags
set
  audience = 'targeted',
  plan_codes = case key
    when 'module.content' then array['business','growth','pro']::text[]
    when 'module.leads' then array['business','growth','pro']::text[]
    when 'module.customers' then array['business','growth','pro']::text[]
    when 'module.campaigns' then array['growth','pro']::text[]
    when 'module.creative_studio' then array['growth','pro']::text[]
    when 'module.whatsapp' then array['growth','pro']::text[]
    when 'module.analytics' then array['growth','pro']::text[]
    when 'module.flow_ai' then array['growth','pro']::text[]
    when 'module.automations' then array['growth','pro']::text[]
    when 'module.integrations' then array['growth','pro']::text[]
    else plan_codes
  end,
  rollout_percentage = 0,
  updated_at = now()
where key in (
  'module.content','module.leads','module.customers','module.campaigns',
  'module.creative_studio','module.whatsapp','module.analytics',
  'module.flow_ai','module.automations','module.integrations'
);
