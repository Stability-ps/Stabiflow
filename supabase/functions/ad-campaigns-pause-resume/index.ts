// Pause/resume a published campaign (Phase 6 instruction #17). Same
// two-step authorization shape as ad-campaigns-publish: verify the
// caller's OWN campaign.pause permission on their own session first, then
// switch to the service-role client to resolve the workspace's Meta token
// and make the actual Graph API call. Deliberately gated by a single
// campaign.pause permission for BOTH directions - resuming spend is just
// as consequential as pausing it, so no separate lower-friction
// "campaign.resume" permission exists.
//
// Only a campaign that has actually been published (local status 'active'
// or 'paused', with an external_campaign_id) can be paused/resumed - a
// draft/ready/failed campaign was never sent to Meta and has nothing to
// pause. Pausing acts at the CAMPAIGN level only: Meta does not deliver
// ad sets/ads under a paused campaign regardless of their own configured
// status, so cascading the call to every ad set/ad individually is
// unnecessary - this is documented, not an oversight.
import { updateObjectStatus } from "../_shared/ad-providers/metaMarketingApi.ts";
import { sanitizeAdErrorForStorage } from "../_shared/ad-providers/metaAdsErrorClassifier.ts";
import { bearerToken, createCallerClient, createServiceClient, envVar, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { emitDomainEvent } from "../_shared/automations/emitDomainEvent.ts";
import { assertWorkspaceActive, workspaceSuspendedBody } from "../_shared/workspaceStatus.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { campaign_id?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const campaignId = body.campaign_id;
  const action = body.action;
  if (typeof campaignId !== "string" || !campaignId) return json(req, { error: "campaign_id is required" }, 400);
  if (action !== "pause" && action !== "resume") return json(req, { error: "action must be 'pause' or 'resume'" }, 400);

  const { data: campaign, error: fetchError } = await callerSb
    .from("ad_campaigns")
    .select("id, workspace_id, integration_id, status, external_campaign_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (fetchError) return json(req, { error: "Unable to load campaign" }, 500);
  if (!campaign) return json(req, { error: "Campaign not found" }, 404);

  if (!(await hasWorkspacePermission(callerSb, campaign.workspace_id, "campaign.pause"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const serviceSb = createServiceClient();

  // Only RESUME is blocked for a suspended/cancelled workspace - pausing
  // is a cost-reducing safety action and must stay available regardless
  // of status; only resuming spend is the "costly provider mutation" the
  // launch-completion status gate exists to prevent.
  if (action === "resume") {
    const statusGate = await assertWorkspaceActive(serviceSb, campaign.workspace_id);
    if (!statusGate.allowed) return json(req, workspaceSuspendedBody(statusGate.status), 403);
  }

  if (!campaign.external_campaign_id || (campaign.status !== "active" && campaign.status !== "paused")) {
    return json(req, { error: `This campaign is not in a pausable/resumable state (current status: ${campaign.status}).` }, 409);
  }
  if (action === "pause" && campaign.status === "paused") return json(req, { error: "Campaign is already paused." }, 409);
  if (action === "resume" && campaign.status === "active") return json(req, { error: "Campaign is already active." }, 409);

  const nowIso = new Date().toISOString();

  // Atomic claim identical in spirit to publish's claim: only proceed if
  // the row is still in the expected state at UPDATE time, so two
  // concurrent pause clicks (or a pause racing a resume) can't both apply.
  const expectedStatus = action === "pause" ? "active" : "paused";
  const { data: claimed } = await serviceSb
    .from("ad_campaigns")
    .update({ updated_at: nowIso })
    .eq("id", campaignId)
    .eq("status", expectedStatus)
    .select("id")
    .maybeSingle();
  if (!claimed) return json(req, { error: "This campaign's status just changed - please refresh and try again." }, 409);

  try {
    const { data: tokenValue, error: tokenError } = await serviceSb.rpc("get_workspace_integration_secret", { p_integration_id: campaign.integration_id });
    if (tokenError || !tokenValue) throw new Error("Unable to resolve this workspace's Meta access token");

    await updateObjectStatus(
      { token: tokenValue, apiVersion: envVar("AD_META_GRAPH_API_VERSION") },
      campaign.external_campaign_id,
      action === "pause" ? "PAUSED" : "ACTIVE",
    );

    const newStatus = action === "pause" ? "paused" : "active";
    await serviceSb
      .from("ad_campaigns")
      .update({ status: newStatus, provider_configured_status: action === "pause" ? "PAUSED" : "ACTIVE", updated_at: new Date().toISOString() })
      .eq("id", campaignId);

    await serviceSb.from("workspace_activity_log").insert({
      workspace_id: campaign.workspace_id,
      actor_user_id: actorId,
      action: action === "pause" ? "campaign_paused" : "campaign_resumed",
      target_type: "ad_campaign",
      target_id: campaignId,
      metadata: {},
    });

    // Taxonomy (approved Phase J) has no campaign.resumed - a resume
    // returns the campaign to the same "actively delivering at Meta"
    // state that a fresh publish reaches, so it reuses campaign.published;
    // a pause is the only state with its own distinct event type.
    await emitDomainEvent(serviceSb, {
      workspaceId: campaign.workspace_id,
      eventType: action === "pause" ? "campaign.paused" : "campaign.published",
      entityType: "ad_campaign",
      entityId: campaignId,
      payload: { entity_id: campaignId },
      dedupeKey: `campaign.${action === "pause" ? "paused" : "published"}:${campaignId}:${nowIso}`,
    });

    return json(req, { ok: true, status: newStatus });
  } catch (error) {
    // Revert the optimistic status back to what it was before this attempt
    // - the Graph API call failed, so nothing actually changed at Meta.
    await serviceSb.from("ad_campaigns").update({ status: expectedStatus, last_publish_error: sanitizeAdErrorForStorage(error), updated_at: new Date().toISOString() }).eq("id", campaignId);
    return json(req, { error: `Unable to ${action} this campaign at Meta. Please try again.` }, 502);
  }
});
