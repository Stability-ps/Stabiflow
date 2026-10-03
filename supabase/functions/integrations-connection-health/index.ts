// Connection health check for Meta OR WhatsApp (Phase C instruction #8/
// #32/#33). Validates the workspace's ACTUAL provider resources via live
// Graph API calls rather than trusting workspace_integrations.status - a
// row can say "connected" while the underlying token has since been
// revoked at the provider, and this is the one place that finds out.
// Manual-trigger only (instruction #33: no aggressive cron for V1).
//
// Same two-step authorization as every other permission-gated edge
// function: verify the caller's own permission on their own session
// first, then switch to the service-role client only to resolve the
// vault-backed token (never returned to the client - only the classified
// category/message is).
import { checkMetaAdAccountHealth, checkMetaInstagramHealth, checkMetaPageHealth, checkMetaTokenHealth } from "../_shared/integration-providers/metaDiscovery.ts";
import { checkWhatsAppNumberHealth } from "../_shared/integration-providers/whatsappDiscovery.ts";
import { subscribeWhatsAppWebhooks, verifyWhatsAppWebhooks, type WebhookSubscriptionResult } from "../_shared/integration-providers/whatsappWebhookSubscription.ts";
import { sanitizeIntegrationError } from "../_shared/integration-providers/metaGraphError.ts";
import { summarizeStatus } from "../_shared/integration-providers/connectionHealthStatus.ts";
import { isBlockedMockRequest, resolveMockMode } from "../_shared/integration-providers/testHarness.ts";
import type { IntegrationErrorCategory } from "../_shared/integration-providers/types.ts";
import { bearerToken, createCallerClient, createServiceClient, envVar, getCallerUserId, hasWorkspacePermission, json, optionalEnvVar } from "../_shared/contentAuth.ts";

type ResourceHealth = { type: string; id: string; label: string; healthy: boolean; category?: IntegrationErrorCategory; message?: string };

async function checkResource(fn: () => Promise<unknown>, type: string, id: string, label: string): Promise<ResourceHealth> {
  try {
    await fn();
    return { type, id, label, healthy: true };
  } catch (error) {
    const sanitized = sanitizeIntegrationError(error);
    return { type, id, label, healthy: false, category: sanitized.category, message: sanitized.message };
  }
}

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

  let body: { workspace_id?: unknown; provider?: unknown; repair?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const workspaceId = body.workspace_id;
  const provider = body.provider;
  // repair === true (WhatsApp only): also (re-)POST the webhook
  // subscription for this workspace's WABA(s), not just read it. This
  // MUTATES provider state, so it needs integration.manage, not the
  // integration.view a plain read-only health check needs.
  const repairWebhook = body.repair === true;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (provider !== "meta" && provider !== "whatsapp") return json(req, { error: "provider must be 'meta' or 'whatsapp'" }, 400);
  if (repairWebhook && provider !== "whatsapp") return json(req, { error: "repair is only valid for provider 'whatsapp'" }, 400);

  if (!(await hasWorkspacePermission(callerSb, workspaceId, "integration.view"))) {
    return json(req, { error: "Forbidden" }, 403);
  }
  if (repairWebhook && !(await hasWorkspacePermission(callerSb, workspaceId, "integration.manage"))) {
    return json(req, { error: "Forbidden" }, 403);
  }
  if (repairWebhook && isBlockedMockRequest(req)) {
    return json(req, { error: "meta_not_enabled", message: "Meta production connection is not enabled yet." }, 403);
  }

  const serviceSb = createServiceClient();
  const nowIso = new Date().toISOString();
  const mockMode = resolveMockMode(req);

  const { data: integration } = await serviceSb
    .from("workspace_integrations")
    .select("id, status, webhook_subscription_status, webhook_subscription_checked_at, webhook_subscription_detail")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (!integration) return json(req, { ok: true, integration: { connected: false }, resources: [] });
  if (integration.status !== "connected") return json(req, { ok: true, integration: { connected: false }, resources: [] });

  const { data: tokenValue, error: tokenError } = await serviceSb.rpc("get_workspace_integration_secret", { p_integration_id: integration.id });
  if (tokenError || !tokenValue) {
    await serviceSb
      .from("workspace_integrations")
      .update({ last_health_check_at: nowIso, last_health_check_status: "reauthorization_required", last_health_check_message: "Stored credential is unavailable." })
      .eq("id", integration.id);
    return json(req, { ok: true, integration: { connected: false, category: "expired_token" as IntegrationErrorCategory }, resources: [] });
  }

  const cred = { token: tokenValue, apiVersion: envVar("INTEGRATIONS_META_GRAPH_API_VERSION") };
  const metaAppId = optionalEnvVar("INTEGRATIONS_META_APP_ID");
  const resources: ResourceHealth[] = [];
  let tokenHealthy: boolean;
  let emptyMessage: string | null = null;
  let webhook: WebhookSubscriptionResult | null = null;

  if (provider === "meta") {
    const tokenHealth = await checkResource(() => checkMetaTokenHealth(cred), "token", integration.id, "Meta access token");
    resources.push(tokenHealth);
    tokenHealthy = tokenHealth.healthy;
    if (tokenHealthy) {
      const [{ data: pages }, { data: igAccounts }, { data: adAccounts }] = await Promise.all([
        serviceSb.from("workspace_facebook_pages").select("id, page_id, page_name").eq("workspace_id", workspaceId).eq("is_active", true),
        serviceSb.from("workspace_instagram_accounts").select("id, ig_business_account_id, username").eq("workspace_id", workspaceId).eq("is_active", true),
        serviceSb.from("workspace_meta_ad_accounts").select("id, ad_account_id, name").eq("workspace_id", workspaceId).eq("is_active", true),
      ]);
      for (const page of pages || []) resources.push(await checkResource(() => checkMetaPageHealth(cred, page.page_id), "facebook_page", page.id, page.page_name || page.page_id));
      for (const ig of igAccounts || []) resources.push(await checkResource(() => checkMetaInstagramHealth(cred, ig.ig_business_account_id), "instagram_account", ig.id, ig.username || ig.ig_business_account_id));
      for (const acct of adAccounts || []) resources.push(await checkResource(() => checkMetaAdAccountHealth(cred, acct.ad_account_id), "ad_account", acct.id, acct.name || acct.ad_account_id));
    }
  } else {
    // WhatsApp has no separate "/me" identity check - a phone number's own
    // health check IS the token health check (an invalid/expired token
    // fails the first number lookup the same way it would fail /me).
    const { data: numbers } = await serviceSb.from("workspace_whatsapp_numbers").select("id, phone_number_id, display_phone_number, waba_id").eq("workspace_id", workspaceId).eq("is_active", true);
    if (!numbers || numbers.length === 0) {
      tokenHealthy = true; // nothing to check against yet - not itself a token failure
      // A connected WhatsApp integration with zero selected numbers has
      // nothing usable - reporting "healthy" here would be a vacuous truth
      // (an empty resources array trivially satisfies "every resource is
      // healthy"). Surface it as a distinct, actionable state instead of
      // letting it silently read as fully healthy.
      emptyMessage = "No WhatsApp phone numbers found. Refresh resources or connect a number in your WhatsApp Business Account.";
    } else {
      for (const num of numbers) {
        resources.push(await checkResource(() => checkWhatsAppNumberHealth(cred, num.phone_number_id), "whatsapp_number", num.id, num.display_phone_number || num.phone_number_id));
      }
      tokenHealthy = resources.every((r) => r.category !== "expired_token" && r.category !== "authorization_failure");
    }

    // Webhook subscription: the "connected but deaf" check. Plain health
    // check re-verifies READ-ONLY (GET); repair=true (already
    // integration.manage-gated above) re-POSTs the subscription. Both are
    // mock-aware - the automated suite never makes a real Graph call.
    const wabaIds: string[] = [
      ...new Set(
        ((numbers ?? []) as Array<{ waba_id: string | null }>)
          .map((n) => n.waba_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    if (tokenHealthy) {
      webhook = repairWebhook
        ? await subscribeWhatsAppWebhooks(serviceSb, integration.id, cred, wabaIds, mockMode, metaAppId)
        : await verifyWhatsAppWebhooks(serviceSb, integration.id, cred, wabaIds, mockMode, metaAppId);
    } else {
      // Token is unhealthy - don't attribute that to the webhook. Echo the
      // last stored subscription state without a new Graph call.
      webhook = {
        status: (integration.webhook_subscription_status as WebhookSubscriptionResult["status"]) ?? "unknown",
        detail: integration.webhook_subscription_detail ?? "Not re-checked - the access token needs attention first.",
        perWaba: [],
      };
    }
  }

  const allHealthy = resources.every((r) => r.healthy);
  const { status, message } = summarizeStatus(tokenHealthy, allHealthy, emptyMessage);

  await serviceSb
    .from("workspace_integrations")
    .update({
      last_health_check_at: nowIso,
      last_health_check_status: status,
      last_health_check_message: message,
      ...(allHealthy ? { last_success_at: nowIso } : {}),
    })
    .eq("id", integration.id);

  await serviceSb.from("workspace_activity_log").insert({
    workspace_id: workspaceId,
    actor_user_id: actorId,
    action: allHealthy ? "integration_health_check_passed" : "integration_health_check_failed",
    target_type: "workspace_integration",
    target_id: integration.id,
    metadata: { provider, status, resource_count: resources.length, webhook_status: webhook?.status ?? null, webhook_repaired: repairWebhook },
  });

  // integration.webhook lets the caller distinguish the four states the
  // brief asks for: token unhealthy (integration.healthy=false /
  // status='reauthorization_required') vs connected+subscribed
  // (webhook.status='subscribed') vs connected+not-subscribed
  // ('not_subscribed') vs unknown ('unknown'/'error').
  return json(req, {
    ok: true,
    integration: {
      connected: true,
      healthy: allHealthy,
      status,
      // Phase 15: perWaba is the already-computed per-WABA breakdown
      // (wabaId + subscribed/verified/status + curated error - no token /
      // raw Graph body). Lets the UI show "2 subscribed, 1 needs repair"
      // instead of one collapsed badge.
      webhook: webhook ? { status: webhook.status, detail: webhook.detail, checked_at: nowIso, perWaba: webhook.perWaba } : null,
    },
    resources,
  });
});
