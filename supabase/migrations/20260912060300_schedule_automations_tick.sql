-- Cron -> Edge Function wiring for automations-tick, mirroring
-- 20260826060400_schedule_content_publish_worker.sql's proven pg_cron +
-- pg_net pattern exactly. The shared secret is generated here, inside
-- Postgres, stored in Vault (automations_cron_secret), and must be read
-- back out and set as the AUTOMATIONS_CRON_SECRET edge function secret via
-- `supabase secrets set` as a separate, uncommitted step. The worker is
-- additionally gated by the AUTOMATIONS_ENABLED env kill switch (defaults
-- unset/false) - so scheduling this job is safe even before that secret
-- is configured.
--
-- Every minute (tighter than content's every-5-minutes) - automation
-- reaction time is part of the feature's value ("notify me when a lead
-- goes untouched"), and each tick's own work is bounded (EVENT_BATCH_LIMIT/
-- RUN_BATCH_LIMIT/IDLE_SCAN_LIMIT caps).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'automations_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'automations_cron_secret');
  end if;
end
$$;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'automations-tick' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
exception
  when undefined_table or invalid_schema_name then
    null;
end
$$;

select cron.schedule(
  'automations-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://doarqrjpadejksovxeev.supabase.co/functions/v1/automations-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'automations_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
