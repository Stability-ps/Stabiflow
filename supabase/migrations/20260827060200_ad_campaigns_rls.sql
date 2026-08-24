-- RLS for the Campaigns module (Phase 6 instruction #21/#22/#23).
--
-- ad_campaign_metrics and ad_publish_operations deliberately have NO
-- authenticated INSERT/UPDATE policy: both are written exclusively by
-- server-side edge functions running as the service role (which bypasses
-- RLS entirely), after the caller's own permission was already verified
-- against their own session - identical shape to
-- content_publish_attempts/content-publish-now in Phase 5. This closes the
-- "a client directly writes a fabricated metrics row or operation status"
-- gap without needing a column-level policy.
--
-- ad_sets/ads are select-only for authenticated clients (campaign.view) -
-- they are only ever written by the publish edge function (service role),
-- consistent with "Campaign publishing must be server-side" (instruction
-- #13). ad_creatives and ad_campaigns ARE directly writable by authenticated
-- clients for the draft lifecycle (create/edit a draft, choose a creative)
-- - the server-side boundary is specifically "sending anything to Meta",
-- not "touching the row at all".

alter table public.ad_creatives enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_sets enable row level security;
alter table public.ads enable row level security;
alter table public.ad_publish_operations enable row level security;
alter table public.ad_campaign_metrics enable row level security;

-- ad_creatives ---------------------------------------------------------------

drop policy if exists "ad_creatives_select" on public.ad_creatives;
create policy "ad_creatives_select"
on public.ad_creatives for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'campaign.view'));

drop policy if exists "ad_creatives_insert" on public.ad_creatives;
create policy "ad_creatives_insert"
on public.ad_creatives for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'campaign.create'));

drop policy if exists "ad_creatives_update" on public.ad_creatives;
create policy "ad_creatives_update"
on public.ad_creatives for update
to authenticated
using (public.has_workspace_permission(workspace_id, 'campaign.edit'))
with check (public.has_workspace_permission(workspace_id, 'campaign.edit'));

drop policy if exists "ad_creatives_delete" on public.ad_creatives;
create policy "ad_creatives_delete"
on public.ad_creatives for delete
to authenticated
using (public.has_workspace_permission(workspace_id, 'campaign.delete'));

-- ad_campaigns -----------------------------------------------------------
-- Update is gated by (campaign.edit OR campaign.publish OR campaign.pause):
-- the real "which specific transition" boundary (editing a draft vs.
-- triggering a Meta publish vs. pausing live spend) is enforced by each
-- edge function re-checking its OWN specific permission against the
-- caller's own session before it does anything - see
-- ad-campaigns-publish/index.ts and ad-campaigns-pause-resume/index.ts.
-- RLS's job here is the tenant boundary plus "some legitimate campaign
-- permission", matching the exact pattern already used for
-- content_scheduled_posts in Phase 5.

drop policy if exists "ad_campaigns_select" on public.ad_campaigns;
create policy "ad_campaigns_select"
on public.ad_campaigns for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'campaign.view'));

drop policy if exists "ad_campaigns_insert" on public.ad_campaigns;
create policy "ad_campaigns_insert"
on public.ad_campaigns for insert
to authenticated
with check (public.has_workspace_permission(workspace_id, 'campaign.create'));

drop policy if exists "ad_campaigns_update" on public.ad_campaigns;
create policy "ad_campaigns_update"
on public.ad_campaigns for update
to authenticated
using (
  public.has_workspace_permission(workspace_id, 'campaign.edit')
  or public.has_workspace_permission(workspace_id, 'campaign.publish')
  or public.has_workspace_permission(workspace_id, 'campaign.pause')
)
with check (
  public.has_workspace_permission(workspace_id, 'campaign.edit')
  or public.has_workspace_permission(workspace_id, 'campaign.publish')
  or public.has_workspace_permission(workspace_id, 'campaign.pause')
);

drop policy if exists "ad_campaigns_delete" on public.ad_campaigns;
create policy "ad_campaigns_delete"
on public.ad_campaigns for delete
to authenticated
using (public.has_workspace_permission(workspace_id, 'campaign.delete') and status = 'draft');

-- ad_sets / ads: select-only for clients, matching the "server-side
-- publish materializes these" design.
do $$
declare
  t text;
begin
  foreach t in array array['ad_sets', 'ads']
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_workspace_permission(workspace_id, ''campaign.view''));',
      t || '_select', t
    );
  end loop;
end
$$;

-- ad_publish_operations: select-only for clients (campaign.view) - written
-- exclusively by the publish edge function via the service role.
drop policy if exists "ad_publish_operations_select" on public.ad_publish_operations;
create policy "ad_publish_operations_select"
on public.ad_publish_operations for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'campaign.view'));

-- ad_campaign_metrics: select-only for clients (campaign.metrics.view) -
-- written exclusively by the metrics-sync edge function via the service role.
drop policy if exists "ad_campaign_metrics_select" on public.ad_campaign_metrics;
create policy "ad_campaign_metrics_select"
on public.ad_campaign_metrics for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'campaign.metrics.view'));
