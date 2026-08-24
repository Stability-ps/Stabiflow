-- Temporary, narrowly-scoped helper to read back ad_metrics_cron_secret's
-- value (generated inside Postgres by the previous migration, per the same
-- "never typed into a migration file" rule as content_cron_secret) so it
-- can be set as the AD_METRICS_CRON_SECRET edge function secret via
-- `supabase secrets set`. Grants no new capability beyond what
-- service_role already has directly against vault.decrypted_secrets (see
-- docs/architecture/multi-tenancy.md's verified-grants note) - it only
-- makes that existing capability reachable over PostgREST for this one
-- retrieval. Dropped by the immediately-following migration once used.
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
