// Manual "Refresh resources" - re-runs discovery using the ALREADY-stored
// token, without a new OAuth round trip (Phase C instructions #4/#17). For
// when a Page/number was added at Meta/WhatsApp after the initial connect
// and an admin wants StabiFlow to see it without reconnecting entirely.
import { discoverAndStoreMetaResources, discoverAndStoreWhatsAppResources } from "../_shared/integration-providers/discoverAndStore.ts";
import { sanitizeIntegrationError } from "../_shared/integration-providers/metaGraphError.ts";
import { subscribeWhatsAppWebhooks } from "../_shared/integration-providers/whatsappWebhookSubscription.ts";
import { isBlockedMockRequest, resolveMockMode } from "../_shared/integration-providers/testHarness.ts";
import { bearerToken, createCallerClient, createServiceClient, envVar, getCallerUserId, hasWorkspacePermission, json, optionalEnvVar } from "../_shared/contentAuth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-stabiflow-test-harness", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { workspace_id?: unknown; provider?: unknown; repair_webhook?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const workspaceId = body.workspace_id;
  const provider = body.provider;
  // "Repair subscription": re-run ONLY the WhatsApp webhook subscription
  // against the already-discovered WABA(s), no full resource re-discovery.
  const repairWebhookOnly = body.repair_webhook === true;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (provider !== "meta" && provider !== "whatsapp") return json(req, { error: "provider must be 'meta' or 'whatsapp'" }, 400);
  if (repairWebhookOnly && provider !== "whatsapp") return json(req, { error: "repair_webhook is only valid for provider 'whatsapp'" }, 400);

  if (!(await hasWorkspacePermission(callerSb, workspaceId, "integration.manage"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const serviceSb = createServiceClient();
  const { data: integration } = await serviceSb.from("workspace_integrations").select("id, status").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle();
  if (!integration || integration.status !== "connected") {
    return json(req, { error: "This provider is not connected for this workspace" }, 400);
  }

  const { data: tokenValue, error: tokenError } = await serviceSb.rpc("get_workspace_integration_secret", { p_integration_id: integration.id });
  if (tokenError || !tokenValue) return json(req, { error: "Stored credential is unavailable - try reconnecting" }, 409);

  // Same production/test boundary as integrations-oauth-start/-callback -
  // see testHarness.ts. A real production caller refreshing an
  // already-connected integration must never silently receive fabricated
  // resources either.
  if (isBlockedMockRequest(req)) {
    return json(req, { error: "meta_not_enabled", message: "Meta production connection is not enabled yet. Contact support to enable it." }, 403);
  }

  const mockMode = resolveMockMode(req);
  const cred = { token: tokenValue, apiVersion: envVar("INTEGRATIONS_META_GRAPH_API_VERSION") };
  const metaAppId = optionalEnvVar("INTEGRATIONS_META_APP_ID");

  try {
    if (repairWebhookOnly) {
      const { data: numbers } = await serviceSb
        .from("workspace_whatsapp_numbers")
        .select("waba_id")
        .eq("workspace_id", workspaceId)
        .not("waba_id", "is", null);
      const wabaIds: string[] = [
        ...new Set(
          ((numbers ?? []) as Array<{ waba_id: string | null }>)
            .map((n) => n.waba_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      ];
      const webhook = await subscribeWhatsAppWebhooks(serviceSb, integration.id, cred, wabaIds, mockMode, metaAppId);
      await serviceSb.from("workspace_activity_log").insert({
        workspace_id: workspaceId,
        actor_user_id: actorId,
        action: "whatsapp_webhook_subscription_repaired",
        target_type: "workspace_integration",
        target_id: integration.id,
        metadata: { status: webhook.status, waba_count: webhook.perWaba.length },
      });
      return json(req, { ok: true, webhookSubscription: { status: webhook.status, detail: webhook.detail, wabaCount: webhook.perWaba.length, perWaba: webhook.perWaba } });
    }

    const summary =
      provider === "meta"
        ? await discoverAndStoreMetaResources(serviceSb, workspaceId, integration.id, cred, mockMode)
        : await discoverAndStoreWhatsAppResources(serviceSb, workspaceId, integration.id, cred, mockMode, metaAppId);

    await serviceSb.from("workspace_activity_log").insert({
      workspace_id: workspaceId,
      actor_user_id: actorId,
      action: `${provider}_resources_refreshed`,
      target_type: "workspace_integration",
      target_id: integration.id,
      metadata: { summary },
    });

    return json(req, { ok: true, summary });
  } catch (err) {
    const sanitized = sanitizeIntegrationError(err);
    return json(req, { error: sanitized.message, category: sanitized.category }, 502);
  }
});
