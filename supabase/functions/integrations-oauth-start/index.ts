// Starts a Meta/WhatsApp OAuth connection for a workspace (Phase C
// instructions #3/#10/#29). The caller's OWN session is used to check
// integration.connect (never role rank alone), then a single-use state
// row is minted server-side so the callback can later prove this exact
// (workspace, user) pair initiated the flow - the browser is never
// trusted to carry the workspace id through the redirect to Meta and back
// (a query param the callback would otherwise have to trust blindly).
import { buildMetaAuthorizeUrl, type IntegrationProvider } from "../_shared/integration-providers/metaOAuth.ts";
import { generateOauthState } from "../_shared/integration-providers/oauthState.ts";
import { bearerToken, createCallerClient, createServiceClient, envVar, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";

const STATE_TTL_MINUTES = 10;

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

  if (!(await hasWorkspacePermission(callerSb, workspaceId, "integration.connect"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const serviceSb = createServiceClient();
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000).toISOString();
  const state = generateOauthState();

  // Opportunistic cleanup of this workspace/provider's own expired state
  // rows - deliberately not a cron (instruction #33: keep this conservative).
  await serviceSb.from("workspace_integration_oauth_states").delete().eq("workspace_id", workspaceId).eq("provider", provider).lt("expires_at", nowIso);

  const { error: insertError } = await serviceSb
    .from("workspace_integration_oauth_states")
    .insert({ workspace_id: workspaceId, provider, state, user_id: actorId, expires_at: expiresAt });
  if (insertError) return json(req, { error: "Unable to start connection" }, 500);

  const mockMode = (Deno.env.get("INTEGRATIONS_META_MOCK_MODE") || "").trim().toLowerCase() === "true";

  // Dev-only (instruction #28): with no real Meta App configured, there is
  // no valid client_id to send a real browser to facebook.com's consent
  // dialog with - it would just show Meta's own "invalid app" error page
  // and never redirect back. In mock mode the browser instead goes
  // straight to StabiFlow's OWN callback with a fabricated code, exactly
  // as if Meta had just redirected back after a real consent - the
  // callback's state-claim/permission-reverification logic runs exactly
  // as it would for a real connection; only the token exchange step
  // (inside the callback) is mocked. Never used when
  // INTEGRATIONS_META_MOCK_MODE is unset/false.
  const url = mockMode
    ? (() => {
        const mockUrl = new URL(envVar("INTEGRATIONS_META_OAUTH_REDIRECT_URI"));
        mockUrl.searchParams.set("code", "mock-code");
        mockUrl.searchParams.set("state", state);
        return mockUrl.toString();
      })()
    : buildMetaAuthorizeUrl({
        appId: envVar("INTEGRATIONS_META_APP_ID"),
        apiVersion: envVar("INTEGRATIONS_META_GRAPH_API_VERSION"),
        redirectUri: envVar("INTEGRATIONS_META_OAUTH_REDIRECT_URI"),
        state,
        provider: provider as IntegrationProvider,
      });

  return json(req, { url });
});
