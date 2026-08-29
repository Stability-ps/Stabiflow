// Meta/WhatsApp OAuth callback (Phase C instructions #3/#4/#10/#29/#30).
//
// Hit directly by the browser's redirect FROM Meta, not by StabiFlow's own
// frontend - there is no Supabase session/JWT on this request at all
// (deployed with verify_jwt=false, see supabase/config.toml). Every trust
// decision here is therefore anchored to the server-side
// workspace_integration_oauth_states row, never to a request parameter:
//
//   - state is looked up and atomically claimed (UPDATE ... WHERE
//     used_at IS NULL) BEFORE anything else happens, so the same state
//     value can never be replayed to attach a second connection or
//     overwrite a different workspace's integration (instruction #30).
//   - the workspace_id and user_id used for the rest of this function come
//     ONLY from that claimed row, never from a query parameter - a caller
//     cannot pass their own workspace_id and have it trusted.
//   - the initiating user's membership/permission is re-verified here,
//     server-side, at callback time - not assumed from having reached
//     this point (their role could have changed between clicking Connect
//     and Meta redirecting back).
//   - the browser is only ever redirected back to a FIXED,
//     server-configured origin (INTEGRATIONS_APP_ORIGIN), never to a URL
//     derived from the request, closing the open-redirect risk called out
//     in instruction #29.
import { discoverAndStoreMetaResources, discoverAndStoreWhatsAppResources } from "../_shared/integration-providers/discoverAndStore.ts";
import { sanitizeIntegrationError } from "../_shared/integration-providers/metaGraphError.ts";
import { exchangeCodeForShortLivedToken, exchangeForLongLivedToken } from "../_shared/integration-providers/metaOAuth.ts";
import { isOauthStateValid } from "../_shared/integration-providers/oauthState.ts";
import { isBlockedMockRequest, resolveMockMode } from "../_shared/integration-providers/testHarness.ts";
import { createServiceClient, envVar } from "../_shared/contentAuth.ts";
import { redirectToApp } from "./redirectToApp.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

async function verifyStillAuthorized(serviceSb: AnySupabaseClient, workspaceId: string, userId: string, permission: string): Promise<boolean> {
  const { data: membership } = await serviceSb.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (!membership) return false;
  const { data: grant } = await serviceSb
    .from("workspace_role_permissions")
    .select("permission")
    .eq("role", membership.role)
    .eq("permission", permission)
    .maybeSingle();
  return !!grant;
}

Deno.serve(async (req: Request) => {
  const appOrigin = envVar("INTEGRATIONS_APP_ORIGIN");
  const reqUrl = new URL(req.url);
  const code = reqUrl.searchParams.get("code");
  const state = reqUrl.searchParams.get("state");
  const errorParam = reqUrl.searchParams.get("error");

  if (errorParam) return redirectToApp(appOrigin, { integration_error: "access_denied" });
  if (!code || !state) return redirectToApp(appOrigin, { integration_error: "invalid_request" });

  const serviceSb = createServiceClient();
  const nowIso = new Date().toISOString();

  // Atomic single-use claim: the WHERE used_at IS NULL means only the
  // first request to reach this line for a given state can ever succeed -
  // a replayed callback with the same state gets 0 rows back.
  const { data: claimed } = await serviceSb
    .from("workspace_integration_oauth_states")
    .update({ used_at: nowIso })
    .eq("state", state)
    .is("used_at", null)
    .select("id, workspace_id, provider, user_id, expires_at")
    .maybeSingle();

  if (!claimed) return redirectToApp(appOrigin, { integration_error: "invalid_state" });
  if (!isOauthStateValid({ expires_at: claimed.expires_at, used_at: null }, nowIso)) {
    return redirectToApp(appOrigin, { integration_error: "expired_state" });
  }

  const workspaceId = claimed.workspace_id as string;
  const userId = claimed.user_id as string;
  const provider = claimed.provider as "meta" | "whatsapp";

  if (!(await verifyStillAuthorized(serviceSb, workspaceId, userId, "integration.connect"))) {
    return redirectToApp(appOrigin, { integration_error: "forbidden" });
  }

  // Defense-in-depth, independent of integrations-oauth-start's own block:
  // a real Meta redirect never carries the test-harness header (browsers
  // can't attach custom headers to a navigation), so this can only ever
  // resolve true for a genuine production request while the mock flag is
  // still on for the test suite's benefit - see testHarness.ts.
  if (isBlockedMockRequest(req)) {
    return redirectToApp(appOrigin, { integration_error: "meta_not_enabled" });
  }

  const mockMode = resolveMockMode(req);

  try {
    let accessToken: string;
    let expiresInSeconds: number | null;

    if (mockMode) {
      accessToken = `mock-${provider}-token-${crypto.randomUUID()}`;
      expiresInSeconds = 60 * 24 * 3600; // 60 days, matching Meta's real long-lived token lifetime
    } else {
      const appId = envVar("INTEGRATIONS_META_APP_ID");
      const appSecret = envVar("INTEGRATIONS_META_APP_SECRET");
      const apiVersion = envVar("INTEGRATIONS_META_GRAPH_API_VERSION");
      const redirectUri = envVar("INTEGRATIONS_META_OAUTH_REDIRECT_URI");
      const shortLived = await exchangeCodeForShortLivedToken({ appId, appSecret, apiVersion, redirectUri, code });
      const longLived = await exchangeForLongLivedToken({ appId, appSecret, apiVersion, shortLivedToken: shortLived.accessToken });
      accessToken = longLived.accessToken;
      expiresInSeconds = longLived.expiresInSeconds;
    }

    const tokenExpiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null;

    const { data: integrationRow, error: upsertError } = await serviceSb
      .from("workspace_integrations")
      .upsert(
        {
          workspace_id: workspaceId,
          provider,
          status: "connected",
          connected_by: userId,
          connected_at: nowIso,
          token_expires_at: tokenExpiresAt,
          last_success_at: nowIso,
          disconnected_at: null,
          last_health_check_at: nowIso,
          last_health_check_status: "healthy",
          last_health_check_message: "Connected.",
        },
        { onConflict: "workspace_id,provider" },
      )
      .select("id")
      .single();
    if (upsertError || !integrationRow) throw new Error(upsertError?.message || "Failed to persist integration");

    const { error: secretError } = await serviceSb.rpc("set_workspace_integration_secret", { p_integration_id: integrationRow.id, p_secret: accessToken });
    if (secretError) throw new Error(secretError.message);

    const apiVersion = envVar("INTEGRATIONS_META_GRAPH_API_VERSION");
    const cred = { token: accessToken, apiVersion };

    const summary =
      provider === "meta"
        ? await discoverAndStoreMetaResources(serviceSb, workspaceId, integrationRow.id, cred, mockMode)
        : await discoverAndStoreWhatsAppResources(serviceSb, workspaceId, integrationRow.id, cred, mockMode);

    await serviceSb.from("workspace_activity_log").insert({
      workspace_id: workspaceId,
      actor_user_id: userId,
      action: `${provider}_connected`,
      target_type: "workspace_integration",
      target_id: integrationRow.id,
      metadata: { mock: mockMode, summary },
    });

    if (summary.collisionDetails.length > 0) {
      await serviceSb.from("workspace_activity_log").insert({
        workspace_id: workspaceId,
        actor_user_id: userId,
        action: "integration_resource_collision_skipped",
        target_type: "workspace_integration",
        target_id: integrationRow.id,
        metadata: { collisions: summary.collisionDetails },
      });
    }

    return redirectToApp(appOrigin, { integration_connected: provider });
  } catch (err) {
    const sanitized = sanitizeIntegrationError(err);
    await serviceSb
      .from("workspace_integrations")
      .update({ status: "error", last_health_check_at: nowIso, last_health_check_status: "error", last_health_check_message: sanitized.message })
      .eq("workspace_id", workspaceId)
      .eq("provider", provider);
    return redirectToApp(appOrigin, { integration_error: sanitized.category });
  }
});
