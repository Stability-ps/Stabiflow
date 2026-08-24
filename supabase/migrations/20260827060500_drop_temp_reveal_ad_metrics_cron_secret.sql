-- Drops the temporary reveal helper from the previous migration, now that
-- ad_metrics_cron_secret has been read back and set as the
-- AD_METRICS_CRON_SECRET edge function secret (confirmed in the Phase 6
-- completion report). No functional surface is lost: service_role can
-- still read vault.decrypted_secrets directly, exactly as before this
-- helper existed.
drop function if exists public.reveal_named_vault_secret_once(text);
