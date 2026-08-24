// Pre-publish readiness check (Phase 6 instruction #9). Runs entirely as
// the CALLER - RLS (campaign.view select policy) is the authorization
// boundary, and every row this reads is already scoped to workspaces the
// caller belongs to. No provider (Meta) network call is made here; token
// health is left null (see adReadiness.ts) - a full connection-health
// check is a separate, explicit action (ad-connection-health).
import { checkCampaignReadiness, isReady } from "../_shared/adReadiness.ts";
import { loadReadinessInput, CAMPAIGN_COLUMNS } from "../_shared/adCampaignLoader.ts";
import { bearerToken, createCallerClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const sb = createCallerClient(token);
  const actorId = await getCallerUserId(sb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { campaign_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const campaignId = body.campaign_id;
  if (typeof campaignId !== "string" || !campaignId) return json(req, { error: "campaign_id is required" }, 400);

  const { data: campaign, error: fetchError } = await sb.from("ad_campaigns").select(CAMPAIGN_COLUMNS).eq("id", campaignId).maybeSingle();
  if (fetchError) return json(req, { error: "Unable to load campaign" }, 500);
  if (!campaign) return json(req, { error: "Campaign not found" }, 404);

  if (!(await hasWorkspacePermission(sb, campaign.workspace_id, "campaign.view"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const input = await loadReadinessInput(sb, campaign);
  const issues = checkCampaignReadiness(input);
  const ready = isReady(issues);

  await sb
    .from("ad_campaigns")
    .update({ last_readiness_check: { checked_at: new Date().toISOString(), ready, issues } })
    .eq("id", campaignId);

  await sb.from("workspace_activity_log").insert({
    workspace_id: campaign.workspace_id,
    actor_user_id: actorId,
    action: "campaign_readiness_checked",
    target_type: "ad_campaign",
    target_id: campaignId,
    metadata: { ready, issue_count: issues.length },
  });

  return json(req, { ok: true, ready, issues });
});
