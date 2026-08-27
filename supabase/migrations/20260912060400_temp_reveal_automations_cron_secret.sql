-- Temporary, narrowly-scoped helper to read back automations_cron_secret's
-- value so it can be set as the AUTOMATIONS_CRON_SECRET edge function
-- secret via `supabase secrets set` - exact same pattern and same
-- justification as 20260827060400_temp_reveal_ad_metrics_cron_secret.sql.
-- Dropped by the immediately-following migration once used.
create or replace function public.reveal_named_vault_secret_once(p_name text)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name;
$$;

revoke execute on function public.reveal_named_vault_secret_once(text) from public, anon, authenticated;
grant execute on function public.reveal_named_vault_secret_once(text) to service_role;
