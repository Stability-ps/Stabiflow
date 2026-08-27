// Meta OAuth dialog + token exchange (Phase C instruction #3/#7/#10).
//
// WhatsApp Business Platform connections ride the SAME Meta OAuth
// dialog/token endpoints as a Facebook/Instagram/Ads connection - only the
// requested scopes differ - so this module is provider-agnostic by design
// rather than forking a near-identical "whatsappOAuth.ts" (instruction
// #37: source-agnostic provider boundaries, avoid duplicating OAuth
// boilerplate).
//
// Pure URL/scope builders are exported separately from the fetch-performing
// token-exchange functions so the former can be unit tested with no
// network, matching the established pattern in
// _shared/ad-providers/metaMarketingApi.ts.
import { classifyIntegrationNetworkError, classifyMetaGraphError } from "./metaGraphError.ts";

export type IntegrationProvider = "meta" | "whatsapp";

// Instruction #9: document every permission requested and why.
//
// Meta (Facebook Pages / Instagram / Meta Ads):
//   pages_show_list        - list the Pages this user manages (discovery)
//   pages_read_engagement  - read Page info alongside manage_posts (discovery/health, required by Meta together with manage_posts on current API versions)
//   pages_manage_posts     - publish to a Facebook Page (used by the existing Content module publish flow)
//   instagram_basic        - read the Instagram Business account linked to a Page (discovery)
//   instagram_content_publish - publish to Instagram (used by the existing Content module publish flow)
//   business_management    - list Business-Manager-owned ad accounts reliably (discovery)
//   ads_management          - create/manage ads (used by the existing Campaigns publish flow)
//   ads_read                - read ad accounts and insights (discovery + metrics sync)
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
  "ads_management",
  "ads_read",
];

// WhatsApp Business Platform:
//   whatsapp_business_management - list/read the WhatsApp Business Account and its phone numbers, and (Phase L-1) list its message templates - GET /me/businesses, GET /{business}/owned_whatsapp_business_accounts, GET /{waba}/phone_numbers, GET /{waba}/message_templates are all documented under whatsapp_business_management, not messaging.
//   whatsapp_business_messaging - send/receive messages via the Cloud API (POST /{phone_number_id}/messages) - required by every outbound send path (_shared/inbox/whatsappSend.ts: free-form text via whatsapp-webhook's AI replies and inbox-actions' staff replies, and Phase L-1's template sends) and by the inbound webhook delivery itself.
//
// Phase C originally requested whatsapp_business_management only (least
// privilege: Phase C was connection/discovery only, before anything sent a
// message). Phase D then built the full send/receive Inbox on top of that
// without ever adding this scope - a real gap this comment used to
// document as deliberate-and-deferred; it is now added because Phase D's
// functionality has shipped and depends on it. A workspace that connected
// before this change needs to reconnect once to grant it - Meta re-issues
// a consent screen for the new scope, it does not silently apply.
//
// Production use of either WhatsApp scope still requires Meta's own
// Advanced Access / App Review approval for a real (non-developer-role)
// user to complete this OAuth flow successfully - see
// docs/launch-readiness.md for the current approval status and submission
// checklist. Requesting the scope here does not grant it in production by
// itself.
export const WHATSAPP_SCOPES = ["whatsapp_business_management", "whatsapp_business_messaging"];

export function scopesForProvider(provider: IntegrationProvider): string[] {
  return provider === "meta" ? META_SCOPES : WHATSAPP_SCOPES;
}

export function graphApiBaseUrl(apiVersion: string): string {
  return `https://graph.facebook.com/${apiVersion}`;
}

export function buildMetaAuthorizeUrl(input: {
  appId: string;
  apiVersion: string;
  redirectUri: string;
  state: string;
  provider: IntegrationProvider;
}): string {
  const url = new URL(`https://www.facebook.com/${input.apiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopesForProvider(input.provider).join(","));
  return url.toString();
}

async function tokenRequest<T>(url: URL): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url.toString(), { method: "GET" });
  } catch (error) {
    classifyIntegrationNetworkError(error);
  }
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok || parsed?.error) {
    classifyMetaGraphError(response.status, parsed);
  }
  return parsed as T;
}

export type TokenResult = { accessToken: string; expiresInSeconds: number | null };

export async function exchangeCodeForShortLivedToken(input: {
  appId: string;
  appSecret: string;
  apiVersion: string;
  redirectUri: string;
  code: string;
}): Promise<TokenResult> {
  const url = new URL(`${graphApiBaseUrl(input.apiVersion)}/oauth/access_token`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code", input.code);
  const result = await tokenRequest<{ access_token: string; expires_in?: number }>(url);
  return { accessToken: result.access_token, expiresInSeconds: result.expires_in ?? null };
}

// Short-lived user tokens (~1-2h) are exchanged for a long-lived token
// (~60 days) so a workspace doesn't need to re-authorize every session -
// instruction #7 ("exchange short-lived tokens appropriately").
export async function exchangeForLongLivedToken(input: {
  appId: string;
  appSecret: string;
  apiVersion: string;
  shortLivedToken: string;
}): Promise<TokenResult> {
  const url = new URL(`${graphApiBaseUrl(input.apiVersion)}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("fb_exchange_token", input.shortLivedToken);
  const result = await tokenRequest<{ access_token: string; expires_in?: number }>(url);
  return { accessToken: result.access_token, expiresInSeconds: result.expires_in ?? null };
}
