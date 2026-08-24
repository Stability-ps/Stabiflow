// Connection health check (Phase 6 instruction #10). Validates the
// workspace's ACTUAL Meta resources (token, ad account, Page, Instagram
// account) via live Graph API calls, rather than trusting
// workspace_integrations.status - a row can say "connected" while the
// underlying token has since been revoked at Meta, and this is the one
// place that finds out.
//
// Same two-step authorization as every other campaign edge function:
// verify the caller's own permission on their own session, then switch to
// the service-role client only to resolve the vault-backed token (never
// exposed back to the client - only the classified category/message is).
import { checkAdAccountHealth, checkPageHealth, checkInstagramAccountHealth, checkTokenHealth } from "../_shared/ad-providers/metaMarketingApi.ts";
import { sanitizeAdErrorForStorage } from "../_shared/ad-providers/metaAdsErrorClassifier.ts";
import type { AdErrorCategory } from "../_shared/ad-providers/types.ts";
import { bearerToken, createCallerClient, createServiceClient, envVar, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

type ResourceHealth = { type: string; id: string; label: string; healthy: boolean; category?: AdErrorCategory; message?: string };

async function checkResource(fn: () => Promise<unknown>, type: string, id: string, label: string): Promise<ResourceHealth> {
  try {
    await fn();
    return { type, id, label, healthy: true };
  } catch (error) {
    const sanitized = sanitizeAdErrorForStorage(error);
    return { type, id, label, healthy: false, category: sanitized.category, message: sanitized.message };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { workspace_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const workspaceId = body.workspace_id;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);

  if (!(await hasWorkspacePermission(callerSb, workspaceId, "campaign.view"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const serviceSb: AnySupabaseClient = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: integration } = await serviceSb.from("workspace_integrations").select("id, status").eq("workspace_id", workspaceId).eq("provider", "meta").maybeSingle();
  if (!integration) {
    return json(req, { ok: true, integration: { connected: false, category: "disconnected_integration" as AdErrorCategory }, resources: [] });
  }
  if (integration.status !== "connected") {
    return json(req, { ok: true, integration: { connected: false, category: "disconnected_integration" as AdErrorCategory } , resources: [] });
  }

  const { data: tokenValue, error: tokenError } = await serviceSb.rpc("get_workspace_integration_secret", { p_integration_id: integration.id });
  if (tokenError || !tokenValue) {
    await serviceSb.from("workspace_integrations").update({ last_health_check_at: nowIso, last_health_check_status: "error", last_health_check_message: "token_unavailable" }).eq("id", integration.id);
    return json(req, { ok: true, integration: { connected: false, category: "expired_token" as AdErrorCategory }, resources: [] });
  }
  const cred = { token: tokenValue, apiVersion: envVar("AD_META_GRAPH_API_VERSION") };

  const tokenHealth = await checkResource(() => checkTokenHealth(cred), "token", integration.id, "Meta access token");

  const [{ data: adAccounts }, { data: pages }, { data: igAccounts }] = await Promise.all([
    serviceSb.from("workspace_meta_ad_accounts").select("id, ad_account_id, name").eq("workspace_id", workspaceId).eq("is_active", true),
    serviceSb.from("workspace_facebook_pages").select("id, page_id, page_name").eq("workspace_id", workspaceId).eq("is_active", true),
    serviceSb.from("workspace_instagram_accounts").select("id, ig_business_account_id, username").eq("workspace_id", workspaceId).eq("is_active", true),
  ]);

  const resources: ResourceHealth[] = [tokenHealth];
  if (tokenHealth.healthy) {
    for (const acct of adAccounts || []) {
      resources.push(await checkResource(() => checkAdAccountHealth(cred, acct.ad_account_id.startsWith("act_") ? acct.ad_account_id : `act_${acct.ad_account_id}`), "ad_account", acct.id, acct.name || acct.ad_account_id));
    }
    for (const page of pages || []) {
      resources.push(await checkResource(() => checkPageHealth(cred, page.page_id), "facebook_page", page.id, page.page_name || page.page_id));
    }
    for (const ig of igAccounts || []) {
      resources.push(await checkResource(() => checkInstagramAccountHealth(cred, ig.ig_business_account_id), "instagram_account", ig.id, ig.username || ig.ig_business_account_id));
    }
  }

  const allHealthy = resources.every((r) => r.healthy);
  const summaryMessage = allHealthy ? "All connected resources are healthy." : resources.filter((r) => !r.healthy).map((r) => `${r.label}: ${r.category}`).join("; ");

  await serviceSb
    .from("workspace_integrations")
    .update({ last_health_check_at: nowIso, last_health_check_status: allHealthy ? "healthy" : "issues_found", last_health_check_message: summaryMessage })
    .eq("id", integration.id);

  await serviceSb.from("workspace_activity_log").insert({
    workspace_id: workspaceId,
    actor_user_id: actorId,
    action: "campaign_connection_health_checked",
    target_type: "workspace_integration",
    target_id: integration.id,
    metadata: { healthy: allHealthy, resource_count: resources.length },
  });

  return json(req, { ok: true, integration: { connected: true, healthy: allHealthy }, resources });
});
