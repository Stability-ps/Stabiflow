// WhatsApp Business Platform resource discovery + connection health
// (Phase C instructions #10/#11/#12).
//
// Assumes the connecting Meta user/System User already owns (or is an
// admin of) a Business Manager with a WhatsApp Business Account already
// created - discovers it via GET /me/businesses ->
// /{business_id}/owned_whatsapp_business_accounts ->
// /{waba_id}/phone_numbers. This is a documented, simpler alternative to
// Meta's "Embedded Signup" JS SDK flow (which additionally lets a business
// CREATE a new WABA/number during onboarding); Embedded Signup is called
// out as a future enhancement in the Phase C completion report rather than
// built now, since this phase's objective is the connection FOUNDATION,
// not full WhatsApp number provisioning.
import { classifyIntegrationNetworkError, classifyMetaGraphError } from "./metaGraphError.ts";
import { graphApiBaseUrl } from "./metaOAuth.ts";
import type { DiscoveredWabaPhoneNumber, MetaCredential } from "./types.ts";

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

export function parseBusinessesResponse(json: { data?: Array<{ id: string; name?: string }> }): Array<{ id: string; name: string | null }> {
  return (json.data || []).map((b) => ({ id: b.id, name: b.name ?? null }));
}

export function parseOwnedWabasResponse(json: { data?: Array<{ id: string; name?: string }> }): Array<{ id: string; name: string | null }> {
  return (json.data || []).map((w) => ({ id: w.id, name: w.name ?? null }));
}

export function parseWabaPhoneNumbersResponse(
  json: { data?: Array<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; platform_type?: string; code_verification_status?: string }> },
  wabaId: string,
): DiscoveredWabaPhoneNumber[] {
  return (json.data || []).map((n) => ({
    wabaId,
    phoneNumberId: n.id,
    displayPhoneNumber: n.display_phone_number ?? null,
    verifiedName: n.verified_name ?? null,
    qualityRating: n.quality_rating ?? null,
    platformStatus: n.code_verification_status ?? null,
  }));
}

// --- Fetch-performing functions ----------------------------------------------

export async function fetchBusinesses(cred: MetaCredential): Promise<Array<{ id: string; name: string | null }>> {
  const json = await graphGet<{ data?: Array<{ id: string; name?: string }> }>(cred, "/me/businesses?fields=id,name&limit=200");
  return parseBusinessesResponse(json);
}

export async function fetchOwnedWabas(cred: MetaCredential, businessId: string): Promise<Array<{ id: string; name: string | null }>> {
  const json = await graphGet<{ data?: Array<{ id: string; name?: string }> }>(
    cred,
    `/${businessId}/owned_whatsapp_business_accounts?fields=id,name&limit=200`,
  );
  return parseOwnedWabasResponse(json);
}

export async function fetchWabaPhoneNumbers(cred: MetaCredential, wabaId: string): Promise<DiscoveredWabaPhoneNumber[]> {
  const json = await graphGet<{
    data?: Array<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; code_verification_status?: string }>;
  }>(cred, `/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status&limit=200`);
  return parseWabaPhoneNumbersResponse(json, wabaId);
}

// --- Connection health (instruction #8, WhatsApp equivalent) -----------------

export async function checkWhatsAppNumberHealth(cred: MetaCredential, phoneNumberId: string): Promise<{ id: string; qualityRating: string | null }> {
  const result = await graphGet<{ id: string; quality_rating?: string }>(cred, `/${phoneNumberId}?fields=id,quality_rating`);
  return { id: result.id, qualityRating: result.quality_rating ?? null };
}
