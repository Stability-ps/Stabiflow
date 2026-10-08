-- Scheduled jobs call THIS project's functions, never a hardcoded URL.
--
-- Every cron job used to hardcode https://doarqrjpadejksovxeev.supabase.co.
-- Any other database that ran these migrations (local `supabase start`,
-- preview branches) therefore called PRODUCTION every minute with its own
-- vault secrets and got 403s, filling production function logs with noise.
--
-- Now each job reads the base URL from the vault secret `project_url`:
--   * production: seeded below from the URL the jobs already use, so its
--     behaviour is unchanged;
--   * local: supabase/seed.sql sets it to the local API gateway;
--   * anything without it: the job fails inside its own database (null URL)
--     and never reaches production.
-- New cron jobs must use public.cron_function_url(<function>) the same way.

do $$
declare
  v_existing text;
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    select substring(command from '(https://[a-z0-9]+\.supabase\.co)') into v_existing
    from cron.job where command ~ 'https://[a-z0-9]+\.supabase\.co/functions/v1/' limit 1;
    if v_existing is not null then
      perform vault.create_secret(v_existing, 'project_url', 'Base URL this database''s cron jobs call (functions live under /functions/v1).');
    end if;
  end if;
exception
  when undefined_table or invalid_schema_name then null; -- no pg_cron in this environment
end
$$;

create or replace function public.cron_function_url(p_function text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select rtrim(decrypted_secret, '/') || '/functions/v1/' || p_function
  from vault.decrypted_secrets where name = 'project_url';
$$;
revoke execute on function public.cron_function_url(text) from public, anon, authenticated;

do $$
declare
  j record;
begin
  for j in
    select * from (values
      ('ad-campaigns-metrics-sync',    '*/30 * * * *', 'ad_metrics_cron_secret'),
      ('automations-tick',             '* * * * *',    'automations_cron_secret'),
      ('billing-reconcile-tick',       '*/15 * * * *', 'billing_cron_secret'),
      ('content-publish-worker',       '*/5 * * * *',  'content_cron_secret'),
      ('website-monitor-tick',         '17 3 * * *',   'website_monitor_cron_secret'),
      ('whatsapp-outbound-retry-tick', '* * * * *',    'whatsapp_retry_cron_secret'),
      ('whatsapp-sla-tick',            '* * * * *',    'whatsapp_sla_cron_secret')
    ) as t(fn, sched, secret_name)
  loop
    -- Only rewrite jobs that exist here; schedule and secret are unchanged.
    if exists (select 1 from cron.job where jobname = j.fn) then
      perform cron.schedule(j.fn, j.sched, format($cmd$
  select net.http_post(
    url := public.cron_function_url(%L),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = %L)
    ),
    body := '{}'::jsonb
  );
  $cmd$, j.fn, j.secret_name));
    end if;
  end loop;
exception
  when undefined_table or invalid_schema_name then null;
end
$$;
