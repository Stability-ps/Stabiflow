-- Temporary helper (same pattern as
-- 20260912060400_temp_reveal_automations_cron_secret.sql, which already ran
-- and was dropped): the integration test suite needs to call
-- automations-tick directly (bypassing the once-a-minute pg_cron schedule)
-- to process domain events synchronously within a test, and doing that
-- requires the SAME automations_cron_secret value already stored in Vault
-- and already set as the deployed AUTOMATIONS_CRON_SECRET function secret.
-- Read once via a throwaway script, added to .env.test.local (gitignored,
-- never committed), then dropped in the immediately-following migration.
create or replace function public.reveal_named_vault_secret_once(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = p_name;
  return v_secret;
end;
$$;

revoke execute on function public.reveal_named_vault_secret_once(text) from public, authenticated, anon;
grant execute on function public.reveal_named_vault_secret_once(text) to service_role;
