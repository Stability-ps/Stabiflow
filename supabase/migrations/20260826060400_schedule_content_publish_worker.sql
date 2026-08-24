-- Cron -> Edge Function wiring for the content publish worker, mirroring
-- Acapolite's proven pg_cron + pg_net pattern
-- (20260822180000_schedule_social_publish_worker.sql) for this project.
--
-- The shared secret authenticating this call is generated HERE, inside
-- Postgres (two concatenated gen_random_uuid() calls, hex-only - already
-- proven available in this project, unlike pgcrypto's gen_random_bytes
-- which isn't on the default search_path on this Supabase project) -
-- never typed into a migration file or committed to git in plaintext.
-- It's stored in Supabase Vault (content_cron_secret)
-- and must be read back out (select decrypted_secret from
-- vault.decrypted_secrets where name = 'content_cron_secret') and set as
-- the CONTENT_CRON_SECRET edge function secret via `supabase secrets set`
-- as a separate, uncommitted step - see the Phase 5 completion report for
-- confirmation this was done. The worker itself stays safe to invoke even
-- before that step or before any workspace has content: it is a no-op
-- unless CONTENT_AUTO_PUBLISH_ENABLED (env kill switch, defaults false)
-- AND at least one workspace's
-- content_scheduler_settings.auto_publish_enabled are both true - see
-- _shared/contentSchedulerSettings.ts.
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'content_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'content_cron_secret');
  end if;
end
$$;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'content-publish-worker' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
exception
  when undefined_table or invalid_schema_name then
    null;
end
$$;

select cron.schedule(
  'content-publish-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://doarqrjpadejksovxeev.supabase.co/functions/v1/content-publish-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'content_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
