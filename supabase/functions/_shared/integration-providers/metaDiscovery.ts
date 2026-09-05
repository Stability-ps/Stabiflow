// Meta resource discovery + connection health (Phase C instructions #4/#8).
//
// Pure response parsers are exported separately from the fetch-performing
// functions so discovery/normalization logic is unit-testable with no
// network - same separation as _shared/ad-providers/metaMarketingApi.ts.
import { classifyIntegrationNetworkError, classifyMetaGraphError } from "./metaGraphError.ts";
import { graphApiBaseUrl } from "./metaOAuth.ts";
import type { DiscoveredAdAccount, DiscoveredFacebookPage, DiscoveredInstagramAccount, MetaCredential } from "./types.ts";

async function graphGet<T>(cred: MetaCredential, path: string): Promise<T> {
  const url = new URL(`${graphApiBaseUrl(cred.apiVersion)}${path}`);
  url.searchParams.set("access_token", cred.token);
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

// --- Pure parsers (unit tested) ----------------------------------------------

export function parseFacebookPagesResponse(json: { data?: Array<{ id: string; name: string }> }): DiscoveredFacebookPage[] {
  return (json.data || []).map((p) => ({ pageId: p.id, pageName: p.name }));
}

export function parseInstagramLinkResponse(
  json: { instagram_business_account?: { id: string; username?: string } },
  pageId: string,
): DiscoveredInstagramAccount | null {
  const ig = json.instagram_business_account;
  if (!ig) return null;
  return { igBusinessAccountId: ig.id, username: ig.username ?? null, linkedPageId: pageId };
}

export function parseAdAccountsResponse(json: {
  data?: Array<{ id: string; name?: string; currency?: string; timezone_name?: string; account_status?: number }>;
}): DiscoveredAdAccount[] {
  return (json.data || []).map((a) => ({
    adAccountId: a.id.startsWith("act_") ? a.id.slice(4) : a.id,
    name: a.name ?? null,
    currency: a.currency ?? null,
    timezone: a.timezone_name ?? null,
    accountStatus: typeof a.account_status === "number" ? a.account_status : null,
  }));
}

// --- Fetch-performing functions ----------------------------------------------

export async function fetchFacebookPages(cred: MetaCredential): Promise<DiscoveredFacebookPage[]> {
  const json = await graphGet<{ data?: Array<{ id: string; name: string }> }>(cred, "/me/accounts?fields=id,name&limit=200");
  return parseFacebookPagesResponse(json);
}

export async function fetchInstagramForPage(cred: MetaCredential, pageId: string): Promise<DiscoveredInstagramAccount | null> {
  const json = await graphGet<{ instagram_business_account?: { id: string; username?: string } }>(
    cred,
    `/${pageId}?fields=instagram_business_account{id,username}`,
  );
  return parseInstagramLinkResponse(json, pageId);
}

export async function fetchAdAccounts(cred: MetaCredential): Promise<DiscoveredAdAccount[]> {
  const json = await graphGet<{ data?: Array<{ id: string; name?: string; currency?: string; timezone_name?: string; account_status?: number }> }>(
    cred,
    "/me/adaccounts?fields=id,name,currency,timezone_name,account_status&limit=200",
  );
  return parseAdAccountsResponse(json);
}

// --- Connection health (instruction #8) --------------------------------------

export async function checkMetaTokenHealth(cred: MetaCredential): Promise<{ userId: string }> {
  const result = await graphGet<{ id: string }>(cred, "/me?fields=id");
  return { userId: result.id };
}

export async function checkMetaPageHealth(cred: MetaCredential, pageId: string): Promise<{ id: string }> {
  return graphGet<{ id: string }>(cred, `/${pageId}?fields=id`);
}

export async function checkMetaInstagramHealth(cred: MetaCredential, igBusinessAccountId: string): Promise<{ id: string }> {
  return graphGet<{ id: string }>(cred, `/${igBusinessAccountId}?fields=id`);
}

export async function checkMetaAdAccountHealth(cred: MetaCredential, adAccountId: string): Promise<{ id: string; accountStatus: number }> {
  const external = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const result = await graphGet<{ id: string; account_status: number }>(cred, `/${external}?fields=id,account_status`);
  return { id: result.id, accountStatus: result.account_status };
}
