// Publish a campaign to Meta (Phase 6 instruction #13 - server-side
// publish pipeline; #14 - idempotency).
//
// Authorization is two-step, same shape as content-publish-now:
//   1. Verify the CALLER's own campaign.publish permission on this exact
//      campaign's workspace, using their own session.
//   2. Only after that passes, switch to the service-role client, because
//      resolving the workspace's Meta token requires
//      get_workspace_integration_secret() (EXECUTE revoked from
//      authenticated/anon by design).
//
// Idempotency (instruction #14): the client supplies `idempotency_key`
// (minted once, when the Publish confirmation step is first shown - see
// src/lib/adCampaigns.ts). A request whose key already has an
// ad_publish_operations row is a REPLAY - this function returns that
// operation's already-recorded outcome without touching Meta again, so a
// frontend retry (timeout, double click, network retry) can never create a
// second paid campaign. A genuinely new key still can't proceed unless the
// atomic claim (claimCampaignForPublish: status 'ready'|'failed' ->
// 'publishing') succeeds, which is what actually prevents two DIFFERENT
// idempotency keys from concurrently publishing the same campaign.
import { checkCampaignReadiness, isReady } from "../_shared/adReadiness.ts";
import { loadReadinessInput, CAMPAIGN_COLUMNS } from "../_shared/adCampaignLoader.ts";
import { claimCampaignForPublish, executeCampaignPublish, REAL_META_PROVIDER, type MetaAdsProvider, type PublishStep } from "../_shared/adPublishExecution.ts";
import * as mockMetaProvider from "../_shared/ad-providers/metaMarketingApiMock.ts";
import { bearerToken, createCallerClient, createServiceClient, envVar, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { emitDomainEvent } from "../_shared/automations/emitDomainEvent.ts";

const MOCK_PROVIDER: MetaAdsProvider = mockMetaProvider;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { campaign_id?: unknown; idempotency_key?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const campaignId = body.campaign_id;
  const idempotencyKey = body.idempotency_key;
  if (typeof campaignId !== "string" || !campaignId) return json(req, { error: "campaign_id is required" }, 400);
  if (typeof idempotencyKey !== "string" || !UUID_RE.test(idempotencyKey)) return json(req, { error: "idempotency_key must be a uuid" }, 400);

  const { data: existing, error: fetchError } = await callerSb.from("ad_campaigns").select(CAMPAIGN_COLUMNS).eq("id", campaignId).maybeSingle();
  if (fetchError) return json(req, { error: "Unable to load campaign" }, 500);
  if (!existing) return json(req, { error: "Campaign not found" }, 404);

  if (!(await hasWorkspacePermission(callerSb, existing.workspace_id, "campaign.publish"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const serviceSb = createServiceClient();

  // Idempotent replay: this exact key was already used for a publish
  // attempt on this campaign - return its recorded outcome, never re-run.
  const { data: existingOp } = await serviceSb.from("ad_publish_operations").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingOp) {
    if (existingOp.campaign_id !== campaignId) {
      return json(req, { error: "This idempotency key was already used for a different campaign" }, 409);
    }
    const { data: campaignNow } = await serviceSb.from("ad_campaigns").select("id, status, external_campaign_id, last_publish_error").eq("id", campaignId).maybeSingle();
    return json(req, { ok: existingOp.status === "succeeded", replay: true, operation: { id: existingOp.id, status: existingOp.status, steps: existingOp.steps }, campaign: campaignNow });
  }

  await serviceSb.from("workspace_activity_log").insert({
    workspace_id: existing.workspace_id,
    actor_user_id: actorId,
    action: "campaign_publish_attempted",
    target_type: "ad_campaign",
    target_id: campaignId,
    metadata: { idempotency_key: idempotencyKey },
  });

  const nowIso = new Date().toISOString();
  const claimed = await claimCampaignForPublish(serviceSb, campaignId, nowIso);
  if (!claimed) {
    const { data: currentState } = await serviceSb.from("ad_campaigns").select("status").eq("id", campaignId).maybeSingle();
    return json(req, {
      error: `This campaign cannot be published from its current state (${currentState?.status ?? "unknown"}). It may already be publishing, active, or was just claimed by another request.`,
    }, 409);
  }

  // Re-validate readiness server-side even though the UI should already
  // have shown a green checklist - "frontend checks are UX only" applies
  // here exactly as it does in Content (instruction #9).
  const readinessInput = await loadReadinessInput(serviceSb, claimed);
  const issues = checkCampaignReadiness(readinessInput);
  if (!isReady(issues)) {
    await serviceSb.from("ad_campaigns").update({ status: "ready", last_readiness_check: { checked_at: nowIso, ready: false, issues } }).eq("id", campaignId);
    await serviceSb.from("workspace_activity_log").insert({
      workspace_id: existing.workspace_id,
      actor_user_id: actorId,
      action: "campaign_publish_failed",
      target_type: "ad_campaign",
      target_id: campaignId,
      metadata: { reason: "not_ready", issue_count: issues.length },
    });
    return json(req, { error: "Campaign is not ready to publish.", issues }, 422);
  }

  const { data: operation, error: opError } = await serviceSb
    .from("ad_publish_operations")
    .insert({
      workspace_id: existing.workspace_id,
      campaign_id: campaignId,
      idempotency_key: idempotencyKey,
      status: "in_progress",
      requested_by: actorId,
      started_at: nowIso,
    })
    .select("id")
    .single();
  if (opError || !operation) {
    // A unique-violation here means a concurrent request won the race to
    // insert this exact idempotency_key between our lookup and this
    // insert - treat it the same as the replay path above.
    if (opError?.code === "23505") {
      const { data: raced } = await serviceSb.from("ad_publish_operations").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
      return json(req, { ok: raced?.status === "succeeded", replay: true, operation: raced ? { id: raced.id, status: raced.status, steps: raced.steps } : null }, 202);
    }
    await serviceSb.from("ad_campaigns").update({ status: "failed", last_publish_error: { code: "operation_insert_failed", message: opError?.message } }).eq("id", campaignId);
    return json(req, { error: "Unable to record the publish operation" }, 500);
  }

  // Mock mode (Phase F instruction #43): deployment-wide, the same
  // INTEGRATIONS_META_MOCK_MODE flag Phase C's OAuth connect already uses
  // - a workspace connected while this is true has a fabricated token, so
  // this is the only safe moment to hand the saga a provider that fakes
  // its Meta responses too rather than letting every step fail against a
  // fake token. mock_fail_step is a test-only hook read from the
  // campaign's own audience jsonb, and is only ever honored when mock
  // mode is active - never in a real deployment.
  const mockMode = (Deno.env.get("INTEGRATIONS_META_MOCK_MODE") || "").trim().toLowerCase() === "true";
  const mockFailStep = mockMode ? (((claimed.audience as Record<string, unknown> | null)?._mock_fail_step as PublishStep | undefined) ?? null) : null;

  const result = await executeCampaignPublish(serviceSb, claimed, {
    actorUserId: actorId,
    apiVersion: envVar("AD_META_GRAPH_API_VERSION"),
    operationId: operation.id,
    provider: mockMode ? MOCK_PROVIDER : REAL_META_PROVIDER,
    mockFailStep,
  });

  await serviceSb.from("workspace_activity_log").insert({
    workspace_id: existing.workspace_id,
    actor_user_id: actorId,
    action: result.outcome === "success" ? "campaign_published" : "campaign_publish_failed",
    target_type: "ad_campaign",
    target_id: campaignId,
    metadata: { outcome: result.outcome, steps: result.steps.map((s) => ({ step: s.step, status: s.status })) },
  });

  // Taxonomy has no campaign.publish_failed - a failed publish is only
  // ever visible via workspace_activity_log/run polling, never a domain
  // event; automations trigger on genuinely successful publishes only.
  if (result.outcome === "success") {
    await emitDomainEvent(serviceSb, {
      workspaceId: existing.workspace_id,
      eventType: "campaign.published",
      entityType: "ad_campaign",
      entityId: campaignId,
      payload: { entity_id: campaignId, operation_id: operation.id },
      dedupeKey: `campaign.published:${operation.id}`,
    });
  }

  const { data: finalCampaign } = await serviceSb.from("ad_campaigns").select("id, status, external_campaign_id, provider_state, last_publish_error").eq("id", campaignId).maybeSingle();

  return json(req, {
    ok: result.outcome === "success",
    outcome: result.outcome,
    operation: { id: operation.id, steps: result.steps },
    campaign: finalCampaign,
  });
});
