-- Cron -> Edge Function wiring for the ad campaign metrics sync worker
-- (Phase 6 instruction #19), mirroring the Phase 5 pg_cron + pg_net pattern
-- (20260826060400_schedule_content_publish_worker.sql).
--
-- Deliberately a coarser cadence than the content publish worker: metrics
-- are a background refresh, not a time-sensitive action, and Meta's
-- Marketing API insights endpoints are rate-limited per ad account. Every
-- 30 minutes is the cron trigger, but the worker itself only refreshes
-- campaigns whose last sync is older than AD_METRICS_STALE_MINUTES (see
-- ad-campaigns-metrics-sync/index.ts) and caps how many campaigns it
-- touches per run - "do not create a cron job that unnecessarily refreshes
-- every campaign every few minutes" is enforced in the worker's own query,
-- not just the cron interval.
--
-- The shared secret is generated the same way as content_cron_secret:
-- inside Postgres, never typed into a migration file. It must be read back
-- (select decrypted_secret from vault.decrypted_secrets where name =
-- 'ad_metrics_cron_secret') and set as the AD_METRICS_CRON_SECRET edge
-- function secret via `supabase secrets set` as a separate, uncommitted
-- step - see the Phase 6 completion report for confirmation this was done.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ad_metrics_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'ad_metrics_cron_secret');
  end if;
end
$$;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'ad-campaigns-metrics-sync' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
exception
  when undefined_table or invalid_schema_name then
    null;
end
$$;

select cron.schedule(
  'ad-campaigns-metrics-sync',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://doarqrjpadejksovxeev.supabase.co/functions/v1/ad-campaigns-metrics-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ad_metrics_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
