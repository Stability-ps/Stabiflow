// WhatsApp webhook subscription (inbound reliability).
//
// Removes the "connected but deaf" failure mode: a WABA that is connected
// and discovered but never subscribed to the StabiFlow Meta app's webhook
// receives no inbound messages, with no signal anywhere. Meta's documented
// primitive for this is:
//
//   POST /{waba-id}/subscribed_apps   -> subscribes THIS app (identified
//                                        by the access token) to the WABA
//   GET  /{waba-id}/subscribed_apps   -> lists apps currently subscribed
//
// The POST is idempotent - re-subscribing an already-subscribed app is a
// success, which is exactly what a "Repair subscription" action needs.
//
// Multi-tenant, no Acapolite wiring: the credential is the per-workspace
// Vault token passed in by the caller (never a global WHATSAPP_ACCESS_TOKEN
// env var), the app is whatever `INTEGRATIONS_META_APP_ID` names, and the
// WABA ids come from THIS workspace's discovered `workspace_whatsapp_numbers`
// rows. Nothing here reads or trusts a caller-supplied workspace/app id.
import { classifyIntegrationNetworkError, classifyMetaGraphError, sanitizeIntegrationError } from "./metaGraphError.ts";
import { fetchWithTimeout } from "./fetchWithTimeout.ts";
import { graphApiBaseUrl } from "./metaOAuth.ts";
import type { MetaCredential } from "./types.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

export type WebhookSubscriptionState = "subscribed" | "not_subscribed" | "unknown" | "error";

export type PerWabaSubscription = {
  wabaId: string;
  // true = confirmed subscribed, false = confirmed NOT subscribed,
  // null = could not determine (e.g. the verify GET failed after a POST
  // that itself succeeded - the POST result is still trusted for `status`).
  subscribed: boolean | null;
  // Phase 15: the verify GET outcome, distinct from `subscribed` (which
  // trusts the POST when the GET fails). true = GET listed this app,
  // false = GET ran but did not list it, null = GET not attempted or
  // failed. Always set by the subscribe/verify functions; optional only so
  // legacy callers of the pure summarizer need not synthesise it.
  verified?: boolean | null;
  // Phase 15: this one WABA folded to a single label for the UI list.
  status?: WebhookSubscriptionState;
  // Curated (sanitizeIntegrationError) - never a raw Graph body / token.
  error: string | null;
};

/** One WABA's outcome as a single label. Pure. */
export function perWabaStatus(p: Pick<PerWabaSubscription, "subscribed" | "error">): WebhookSubscriptionState {
  if (p.error) return "error";
  if (p.subscribed === true) return "subscribed";
  if (p.subscribed === false) return "not_subscribed";
  return "unknown";
}

export type WebhookSubscriptionResult = {
  status: WebhookSubscriptionState;
  detail: string;
  perWaba: PerWabaSubscription[];
};

function subscribedAppsUrl(cred: MetaCredential, wabaId: string): string {
  const url = new URL(`${graphApiBaseUrl(cred.apiVersion)}/${encodeURIComponent(wabaId)}/subscribed_apps`);
  url.searchParams.set("access_token", cred.token);
  return url.toString();
}

/** POST /{waba-id}/subscribed_apps. Resolves on success; throws a
 * classified Temporary/PermanentIntegrationError on any Graph or network
 * failure (caller is expected to catch - a subscription failure must never
 * abort discovery/connect). */
export async function subscribeWabaToApp(cred: MetaCredential, wabaId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetchWithTimeout(subscribedAppsUrl(cred, wabaId), { method: "POST" });
  } catch (error) {
    classifyIntegrationNetworkError(error);
  }
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok || (parsed && (parsed as { error?: unknown }).error)) {
    classifyMetaGraphError(response.status, parsed as Record<string, unknown>);
  }
}

/** Parses GET /{waba-id}/subscribed_apps into the list of subscribed app
 * ids. Meta returns `{ data: [ { whatsapp_business_api_data: { id, name,
 * link } } ] }`; older shapes put `id` at the top level. Pure - unit
 * tested. */
export function parseSubscribedAppsResponse(json: unknown): string[] {
  const data =
    json && typeof json === "object" && Array.isArray((json as { data?: unknown[] }).data)
      ? (json as { data: unknown[] }).data
      : [];
  const ids: string[] = [];
  for (const entry of data) {
    const rec = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const apiData =
      rec.whatsapp_business_api_data && typeof rec.whatsapp_business_api_data === "object"
        ? (rec.whatsapp_business_api_data as Record<string, unknown>)
        : {};
    const id = typeof apiData.id === "string" ? apiData.id : typeof rec.id === "string" ? rec.id : null;
    if (id) ids.push(id);
  }
  return ids;
}

/** GET /{waba-id}/subscribed_apps -> subscribed app ids. Same throw
 * contract as subscribeWabaToApp. */
export async function fetchWabaSubscribedApps(cred: MetaCredential, wabaId: string): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchWithTimeout(subscribedAppsUrl(cred, wabaId), { method: "GET" });
  } catch (error) {
    classifyIntegrationNetworkError(error);
  }
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok || (parsed && (parsed as { error?: unknown }).error)) {
    classifyMetaGraphError(response.status, parsed as Record<string, unknown>);
  }
  return parseSubscribedAppsResponse(parsed);
}

/** Folds per-WABA outcomes into one status + one human-readable line.
 * Pure - unit tested. Rules:
 *   - no WABAs at all                -> unknown
 *   - every WABA confirmed subscribed -> subscribed
 *   - any hard error                  -> error   (surfaced, never "healthy")
 *   - any WABA confirmed NOT subscribed (and no error) -> not_subscribed
 *   - otherwise (indeterminate)       -> unknown
 */
export function summarizeWebhookSubscription(results: PerWabaSubscription[]): { status: WebhookSubscriptionState; detail: string } {
  if (results.length === 0) {
    return { status: "unknown", detail: "No WhatsApp Business Account has been discovered for this workspace yet." };
  }
  const errored = results.filter((r) => r.error);
  const confirmed = results.filter((r) => r.subscribed === true);
  const denied = results.filter((r) => r.subscribed === false && !r.error);

  if (confirmed.length === results.length) {
    return {
      status: "subscribed",
      detail:
        confirmed.length === 1
          ? "The WhatsApp Business Account is subscribed to this app's webhook."
          : `All ${confirmed.length} WhatsApp Business Accounts are subscribed to this app's webhook.`,
    };
  }
  if (errored.length > 0) {
    return { status: "error", detail: errored[0].error || "Could not confirm the webhook subscription with Meta." };
  }
  if (denied.length > 0) {
    return {
      status: "not_subscribed",
      detail: `${denied.length} WhatsApp Business Account(s) are not subscribed to this app's webhook. Use "Repair subscription".`,
    };
  }
  return { status: "unknown", detail: "The webhook subscription state could not be determined." };
}

/** Subscribe every distinct WABA to this app, then best-effort verify via
 * GET. NEVER throws - a subscription problem is returned as `status:
 * 'error' | 'not_subscribed'`, never propagated (callers must not let it
 * abort connect/discovery). `expectedAppId` (INTEGRATIONS_META_APP_ID) is
 * used only to confirm the verify GET lists this app; when it is null the
 * POST result alone drives `subscribed`. */
export async function subscribeAndVerifyWabas(
  cred: MetaCredential,
  wabaIds: string[],
  expectedAppId: string | null,
): Promise<WebhookSubscriptionResult> {
  // Phase 15: WABAs are independent - subscribe/verify them concurrently.
  // WITHIN one WABA the POST still strictly precedes its verify GET;
  // ACROSS WABAs they run in parallel. allSettled + an inner catch mean a
  // single WABA's failure can never reject the batch or hide the others.
  const settled = await Promise.allSettled(
    wabaIds.map(async (wabaId): Promise<PerWabaSubscription> => {
      let subscribed: boolean | null = null;
      let verified: boolean | null = null;
      let error: string | null = null;
      try {
        await subscribeWabaToApp(cred, wabaId);
        subscribed = true; // POST succeeded (idempotent)
        if (expectedAppId) {
          try {
            const ids = await fetchWabaSubscribedApps(cred, wabaId);
            verified = ids.includes(expectedAppId);
            subscribed = verified;
          } catch {
            // Verify GET failed but the POST succeeded - trust the POST,
            // leave `subscribed` true, don't manufacture an error.
            verified = null;
            subscribed = true;
          }
        }
      } catch (e) {
        error = sanitizeIntegrationError(e).message;
        subscribed = false;
        verified = null;
      }
      return { wabaId, subscribed, verified, error, status: perWabaStatus({ subscribed, error }) };
    }),
  );
  const perWaba: PerWabaSubscription[] = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          wabaId: wabaIds[i],
          subscribed: false,
          verified: null,
          error: sanitizeIntegrationError(r.reason).message,
          status: "error" as const,
        },
  );
  return { ...summarizeWebhookSubscription(perWaba), perWaba };
}

/** The one place the subscription result is persisted onto the workspace
 * integration row. Shared by discovery (connect + refresh) and the
 * connection-health check/repair. `mockMode` short-circuits to a recorded
 * "subscribed (mock)" WITHOUT any network call - the automated test suite
 * must never make a real Graph API request. Returns the recorded result. */
export async function subscribeWhatsAppWebhooks(
  serviceSb: AnySupabaseClient,
  integrationId: string,
  cred: MetaCredential,
  wabaIds: string[],
  mockMode: boolean,
  expectedAppId: string | null,
): Promise<WebhookSubscriptionResult> {
  const distinct = [...new Set(wabaIds.filter((id): id is string => typeof id === "string" && id.length > 0))];

  let result: WebhookSubscriptionResult;
  if (distinct.length === 0) {
    // Zero discovered WABAs is 'unknown', never a vacuous 'subscribed' -
    // this check comes BEFORE the mock-mode short-circuit.
    result = {
      status: "unknown",
      detail: "No WhatsApp Business Account has been discovered for this workspace yet.",
      perWaba: [],
    };
  } else if (mockMode) {
    result = {
      status: "subscribed",
      detail: "Mock mode - webhook subscription recorded without a Graph API call.",
      perWaba: distinct.map((wabaId) => ({ wabaId, subscribed: true, verified: true, error: null, status: "subscribed" as const })),
    };
  } else {
    result = await subscribeAndVerifyWabas(cred, distinct, expectedAppId);
  }

  await serviceSb
    .from("workspace_integrations")
    .update({
      webhook_subscription_status: result.status,
      webhook_subscription_checked_at: new Date().toISOString(),
      webhook_subscription_detail: result.detail,
    })
    .eq("id", integrationId);

  return result;
}

/** Read-only re-verification for the plain "Check connection" path: GET
 * only, never POST. Same mock-mode and no-WABA short-circuits. */
export async function verifyWhatsAppWebhooks(
  serviceSb: AnySupabaseClient,
  integrationId: string,
  cred: MetaCredential,
  wabaIds: string[],
  mockMode: boolean,
  expectedAppId: string | null,
): Promise<WebhookSubscriptionResult> {
  const distinct = [...new Set(wabaIds.filter((id): id is string => typeof id === "string" && id.length > 0))];

  let result: WebhookSubscriptionResult;
  if (distinct.length === 0) {
    result = {
      status: "unknown",
      detail: "No WhatsApp Business Account has been discovered for this workspace yet.",
      perWaba: [],
    };
  } else if (mockMode) {
    result = {
      status: "subscribed",
      detail: "Mock mode - webhook subscription assumed without a Graph API call.",
      perWaba: distinct.map((wabaId) => ({ wabaId, subscribed: true, verified: true, error: null, status: "subscribed" as const })),
    };
  } else if (!expectedAppId) {
    result = {
      status: "unknown",
      detail: "This deployment has no configured Meta app id to verify against.",
      perWaba: [],
    };
  } else {
    // Phase 15: GET-only re-verification, one concurrent request per WABA.
    const settled = await Promise.allSettled(
      distinct.map(async (wabaId): Promise<PerWabaSubscription> => {
        try {
          const ids = await fetchWabaSubscribedApps(cred, wabaId);
          const verified = ids.includes(expectedAppId);
          return { wabaId, subscribed: verified, verified, error: null, status: perWabaStatus({ subscribed: verified, error: null }) };
        } catch (e) {
          const error = sanitizeIntegrationError(e).message;
          return { wabaId, subscribed: null, verified: null, error, status: "error" as const };
        }
      }),
    );
    const perWaba: PerWabaSubscription[] = settled.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { wabaId: distinct[i], subscribed: null, verified: null, error: sanitizeIntegrationError(r.reason).message, status: "error" as const },
    );
    result = { ...summarizeWebhookSubscription(perWaba), perWaba };
  }

  await serviceSb
    .from("workspace_integrations")
    .update({
      webhook_subscription_status: result.status,
      webhook_subscription_checked_at: new Date().toISOString(),
      webhook_subscription_detail: result.detail,
    })
    .eq("id", integrationId);

  return result;
}
