-- Campaign scheduling: "Start now" support.
--
-- ad_campaigns.start_at becomes NULLABLE. NULL is the explicit, unambiguous
-- representation of "Start now" - the campaign is eligible for immediate
-- publishing (its Meta ad set is created with NO start_time, so Meta starts
-- delivery as soon as the ad set is set ACTIVE, which is exactly what the
-- publish saga already does). A non-null start_at is a scheduled start
-- instant in UTC; if it is in the past at publish time the server-side
-- readiness gate rejects the publish (adReadiness/adMoney), it is never
-- silently bumped forward.
--
-- Backward compatible: every existing row keeps its timestamp and continues
-- to load and validate exactly as before. No data is modified.

alter table public.ad_campaigns
  alter column start_at drop not null;

-- The existing end-after-start check is already NULL-safe (a comparison
-- against NULL yields NULL, which a CHECK treats as satisfied). Re-state it
-- explicitly so the "start_at may be NULL" intent is visible in the schema.
alter table public.ad_campaigns
  drop constraint if exists ad_campaigns_end_after_start;
alter table public.ad_campaigns
  add constraint ad_campaigns_end_after_start
  check (end_at is null or start_at is null or end_at > start_at);

comment on column public.ad_campaigns.start_at is
  'Scheduled start instant (UTC). NULL = "Start now" (immediate publish; Meta ad set created with no start_time). A non-null value that is in the past is a stale schedule the user must correct before publishing.';
