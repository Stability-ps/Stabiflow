// Metrics sync (Phase 6 instruction #19). Two entry points into the same
// worker, mirroring content-publish-worker's cron/manual split:
//   - Cron (x-cron-secret header): batch-refreshes ACTIVE campaigns whose
//     last sync is older than AD_METRICS_STALE_MINUTES, capped at
//     BATCH_LIMIT per run - "do not create a cron job that unnecessarily
//     refreshes every campaign every few minutes" is enforced HERE, not
//     just by the cron interval (every 30 minutes - see the scheduling
//     migration).
//   - Manual refresh (caller JWT): a single campaign, requested by a user
//     viewing its Performance tab. Requires campaign.metrics.view.
//
// Upsert is done as an explicit select-then-write rather than a Postgres
// ON CONFLICT, because ad_campaign_metrics's uniqueness constraint is an
// EXPRESSION index (coalesce(ad_set_id, ...)) to correctly treat
// campaign-level (null ad_set_id/ad_id) rows as a single stable identity -
// PostgREST's upsert only supports a literal column list for onConflict,
// which can't target an expression index, so this avoids that mismatch
// entirely rather than fighting it.
import { fetchCampaignInsights } from "../_shared/ad-providers/metaMarketingApi.ts";
import { sanitizeAdErrorForStorage } from "../_shared/ad-providers/metaAdsErrorClassifier.ts";
import { normalizeInsightsRow } from "../_shared/adMetrics.ts";
import { bearerToken, createCallerClient, createServiceClient, envVar, getCallerUserId, hasWorkspacePermission, JSON_HEADERS } from "../_shared/contentAuth.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

const BATCH_LIMIT = 25;
const LOOKBACK_DAYS = 7;
const DEFAULT_STALE_MINUTES = 180;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, "Cache-Control": "no-store" } });
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function dateRange(days: number): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
}

async function syncOneCampaign(sb: AnySupabaseClient, campaign: { id: string; workspace_id: string; integration_id: string; objective: string; external_campaign_id: string }) {
  const { data: tokenValue, error: tokenError } = await sb.rpc("get_workspace_integration_secret", { p_integration_id: campaign.integration_id });
  if (tokenError || !tokenValue) throw new Error("token_unavailable");

  const cred = { token: tokenValue, apiVersion: envVar("AD_META_GRAPH_API_VERSION") };
  const { since, until } = dateRange(LOOKBACK_DAYS);
  const rows = await fetchCampaignInsights(cred, campaign.external_campaign_id, since, until);

  for (const row of rows) {
    const normalized = normalizeInsightsRow(row, campaign.objective);
    const { data: existing } = await sb
      .from("ad_campaign_metrics")
      .select("id")
      .eq("campaign_id", campaign.id)
      .is("ad_set_id", null)
      .is("ad_id", null)
      .eq("date_start", normalized.date_start)
      .eq("date_stop", normalized.date_stop)
      .maybeSingle();

    const payload = { workspace_id: campaign.workspace_id, campaign_id: campaign.id, ...normalized, raw_provider_response: row, synced_at: new Date().toISOString() };
    if (existing) {
      await sb.from("ad_campaign_metrics").update(payload).eq("id", existing.id);
    } else {
      await sb.from("ad_campaign_metrics").insert(payload);
    }
  }
  return rows.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cronSecret = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret;

  if (isCron) {
    if (!timingSafeEqual(cronSecret, envVar("AD_METRICS_CRON_SECRET"))) return json({ error: "Forbidden" }, 403);

    const sb = createServiceClient();
    const staleCutoffIso = new Date(Date.now() - DEFAULT_STALE_MINUTES * 60 * 1000).toISOString();

    const { data: candidates } = await sb
      .from("ad_campaigns")
      .select("id, workspace_id, integration_id, objective, external_campaign_id")
      .eq("status", "active")
      .not("external_campaign_id", "is", null)
      .limit(BATCH_LIMIT * 3); // over-fetch, then filter by staleness below (no last-synced column on ad_campaigns itself)

    const { data: recentlySynced } = await sb
      .from("ad_campaign_metrics")
      .select("campaign_id")
      .gte("synced_at", staleCutoffIso);
    const freshSet = new Set((recentlySynced || []).map((r: { campaign_id: string }) => r.campaign_id));

    const due = (candidates || []).filter((c: { id: string }) => !freshSet.has(c.id)).slice(0, BATCH_LIMIT);

    let synced = 0;
    let failed = 0;
    for (const campaign of due) {
      try {
        await syncOneCampaign(sb, campaign);
        synced++;
      } catch (error) {
        failed++;
        console.error("ad-campaigns-metrics-sync: campaign sync failed", campaign.id, sanitizeAdErrorForStorage(error));
      }
    }
    return json({ ok: true, processed: due.length, synced, failed });
  }

  // Manual refresh path - caller-authenticated.
  const token = bearerToken(req);
  if (!token) return json({ error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json({ error: "Forbidden" }, 403);

  let body: { campaign_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const campaignId = body.campaign_id;
  if (typeof campaignId !== "string" || !campaignId) return json({ error: "campaign_id is required" }, 400);

  const { data: campaign, error: fetchError } = await callerSb
    .from("ad_campaigns")
    .select("id, workspace_id, integration_id, objective, external_campaign_id, status")
    .eq("id", campaignId)
    .maybeSingle();
  if (fetchError) return json({ error: "Unable to load campaign" }, 500);
  if (!campaign) return json({ error: "Campaign not found" }, 404);

  if (!(await hasWorkspacePermission(callerSb, campaign.workspace_id, "campaign.metrics.view"))) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!campaign.external_campaign_id) {
    return json({ error: "This campaign has not been published yet - no metrics are available." }, 409);
  }

  const serviceSb = createServiceClient();
  try {
    const rowCount = await syncOneCampaign(serviceSb, campaign);
    await serviceSb.from("workspace_activity_log").insert({
      workspace_id: campaign.workspace_id,
      actor_user_id: actorId,
      action: "campaign_metrics_refreshed",
      target_type: "ad_campaign",
      target_id: campaignId,
      metadata: { rows: rowCount, triggered_by: "manual" },
    });
    return json({ ok: true, rows: rowCount });
  } catch (error) {
    console.error("ad-campaigns-metrics-sync: manual refresh failed", campaignId, sanitizeAdErrorForStorage(error));
    return json({ error: "Unable to refresh metrics from Meta right now." }, 502);
  }
});
