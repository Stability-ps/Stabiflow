// Disconnects a provider integration (Phase C instruction #17).
//
// Deliberately does NOT touch workspace_facebook_pages/
// workspace_instagram_accounts/workspace_meta_ad_accounts/
// workspace_whatsapp_numbers, or anything in Content/Campaigns that
// references them - those rows are historical record (past posts,
// campaigns, leads attributed through this connection) and disconnecting
// must never delete them. Only the LIVE ACCESS RELATIONSHIP is removed:
// workspace_integrations.status flips to 'disconnected' and the Vault
// secret is deleted (this project's documented choice for instruction #17
// - a revoked-by-the-user token has no further use and shouldn't linger).
// A later reconnect creates a fresh secret via the same
// set_workspace_integration_secret() RPC the OAuth callback already uses.
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { workspace_id?: unknown; provider?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const workspaceId = body.workspace_id;
  const provider = body.provider;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (provider !== "meta" && provider !== "whatsapp") return json(req, { error: "provider must be 'meta' or 'whatsapp'" }, 400);

  if (!(await hasWorkspacePermission(callerSb, workspaceId, "integration.disconnect"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const serviceSb = createServiceClient();
  const { data: integration } = await serviceSb.from("workspace_integrations").select("id, status").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle();
  if (!integration) return json(req, { error: "Not connected" }, 404);

  const nowIso = new Date().toISOString();

  const { error: clearError } = await serviceSb.rpc("clear_workspace_integration_secret", { p_integration_id: integration.id });
  if (clearError) return json(req, { error: "Unable to disconnect" }, 500);

  const { error: updateError } = await serviceSb
    .from("workspace_integrations")
    .update({ status: "disconnected", disconnected_at: nowIso, last_health_check_at: nowIso, last_health_check_status: "disconnected", last_health_check_message: "Disconnected by a workspace admin." })
    .eq("id", integration.id);
  if (updateError) return json(req, { error: "Unable to disconnect" }, 500);

  await serviceSb.from("workspace_activity_log").insert({
    workspace_id: workspaceId,
    actor_user_id: actorId,
    action: `${provider}_disconnected`,
    target_type: "workspace_integration",
    target_id: integration.id,
    metadata: {},
  });

  return json(req, { ok: true });
});
