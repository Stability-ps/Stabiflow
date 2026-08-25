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
//   whatsapp_business_management - list/read the WhatsApp Business Account and its phone numbers (discovery, this phase)
//   whatsapp_business_messaging  - send/receive messages (NOT used by any code in this phase - Phase C explicitly does not send messages - but requested alongside management now because Meta's own recommended onboarding grants both in one consent, and re-running OAuth solely to add messaging later would be poor UX for a workspace that already connected WhatsApp intending to message). See Phase C completion report for this tradeoff.
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
