-- WhatsApp inbound reliability: record whether this workspace's WhatsApp
-- Business Account(s) are subscribed to the StabiFlow Meta app's webhook.
--
-- Background: a connected WhatsApp integration (OAuth done, token in Vault,
-- resource discovery succeeded, health "healthy") can still receive ZERO
-- inbound messages if the WABA was never subscribed to the app's webhook
-- (`POST /{waba-id}/subscribed_apps`). Nothing in StabiFlow performed that
-- subscription, and the Settings UI hard-coded "Status unavailable" - a
-- "connected but deaf" failure mode with no signal.
--
-- These columns mirror the existing last_health_check_* trio on the same
-- table: free-text status (deliberately NOT a DB enum, same rationale as
-- last_health_check_status - the vocabulary lives in the frontend
-- presenter), a checked-at timestamp, and a sanitized human detail. They
-- carry NO secret. They are written by discoverAndStoreWhatsAppResources
-- (on connect + on every "Refresh") and by integrations-connection-health
-- (plain check re-verifies read-only; the explicit "repair" action
-- re-POSTs the subscription). Meta integrations leave them null.
alter table public.workspace_integrations
  add column if not exists webhook_subscription_status text
    check (webhook_subscription_status in ('subscribed', 'not_subscribed', 'unknown', 'error')),
  add column if not exists webhook_subscription_checked_at timestamptz,
  add column if not exists webhook_subscription_detail text;

comment on column public.workspace_integrations.webhook_subscription_status is
  'WhatsApp only: are this workspace''s WABA(s) subscribed to the StabiFlow Meta app''s webhook (POST /{waba}/subscribed_apps)? subscribed | not_subscribed | unknown | error. null = never checked / not applicable (Meta). Never carries a secret; existing workspace_integrations_select_admin RLS covers it.';
