-- Drops the temporary reveal helper from the previous migration, now that
-- automations_cron_secret has been read back and set as the
-- AUTOMATIONS_CRON_SECRET edge function secret (confirmed in the Phase J
-- completion report). No functional surface is lost: service_role can
-- still read vault.decrypted_secrets directly, exactly as before this
-- helper existed.
drop function if exists public.reveal_named_vault_secret_once(text);
