// Shared discovery-and-store logic used by BOTH the OAuth callback
// (initial discovery right after connecting) and the manual
// "Refresh resources" action (re-discovery using the already-stored
// token, instruction #17 reconnect-adjacent behavior) - one place that
// calls Meta/WhatsApp Graph endpoints and normalizes the result into
// StabiFlow's existing resource tables, per instruction #37 ("the UI
// should call StabiFlow service/edge-function boundaries", not duplicate
// discovery logic per caller).
import { fetchAdAccounts, fetchFacebookPages, fetchInstagramForPage } from "./metaDiscovery.ts";
import { fetchBusinesses, fetchOwnedWabas, fetchWabaPhoneNumbers } from "./whatsappDiscovery.ts";
import { upsertDiscoveredResource } from "./resourceUpsert.ts";
import type { MetaCredential } from "./types.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

export type DiscoverySummary = {
  facebookPages: { discovered: number; new: number; collisions: number };
  instagramAccounts: { discovered: number; new: number; collisions: number };
  adAccounts: { discovered: number; new: number; collisions: number };
  whatsappNumbers: { discovered: number; new: number; collisions: number };
  collisionDetails: Array<{ table: string; providerId: string }>;
};

// Dev-only fixtures (instruction #28: mock provider responses when real
// OAuth cannot safely be completed - no Meta App is configured for this
// dev environment). Names match the illustrative example resources given
// in the Phase C brief itself.
export const MOCK_META_PAGES = [
  { pageId: "mock-page-acapolite", pageName: "Acapolite Consulting" },
  { pageId: "mock-page-taxcoach", pageName: "Tax Coach SA" },
  { pageId: "mock-page-stability", pageName: "Stability Group" },
];
export const MOCK_META_INSTAGRAM: Record<string, { igBusinessAccountId: string; username: string }> = {
  "mock-page-acapolite": { igBusinessAccountId: "mock-ig-acapolite", username: "acapoliteconsulting" },
  "mock-page-taxcoach": { igBusinessAccountId: "mock-ig-taxcoach", username: "taxcoachsa" },
};
export const MOCK_META_AD_ACCOUNTS = [
  { adAccountId: "mock-adacct-acapolite", name: "Acapolite Ads", currency: "ZAR", timezone: "Africa/Johannesburg", accountStatus: 1 },
  { adAccountId: "mock-adacct-stability", name: "Stability Group Ads", currency: "ZAR", timezone: "Africa/Johannesburg", accountStatus: 1 },
];
export const MOCK_WHATSAPP_NUMBERS = [
  { wabaId: "mock-waba-1", phoneNumberId: "mock-phone-1", displayPhoneNumber: "+27 82 000 0001", verifiedName: "Acapolite Consulting", qualityRating: "GREEN", platformStatus: "VERIFIED" },
];

export async function discoverAndStoreMetaResources(
  serviceSb: AnySupabaseClient,
  workspaceId: string,
  integrationId: string,
  cred: MetaCredential,
  mockMode: boolean,
): Promise<DiscoverySummary> {
  const pages = mockMode ? MOCK_META_PAGES : await fetchFacebookPages(cred);
  const summary: DiscoverySummary = {
    facebookPages: { discovered: pages.length, new: 0, collisions: 0 },
    instagramAccounts: { discovered: 0, new: 0, collisions: 0 },
    adAccounts: { discovered: 0, new: 0, collisions: 0 },
    whatsappNumbers: { discovered: 0, new: 0, collisions: 0 },
    collisionDetails: [],
  };

  for (const page of pages) {
    const result = await upsertDiscoveredResource(
      serviceSb,
      "workspace_facebook_pages",
      "page_id",
      page.pageId,
      workspaceId,
      { workspace_id: workspaceId, integration_id: integrationId, page_id: page.pageId, page_name: page.pageName },
      { page_name: page.pageName },
    );
    if (result.collision) {
      summary.facebookPages.collisions++;
      summary.collisionDetails.push({ table: "workspace_facebook_pages", providerId: page.pageId });
      continue;
    }
    if (result.wasNew) summary.facebookPages.new++;

    const igLink = mockMode ? MOCK_META_INSTAGRAM[page.pageId] ?? null : await fetchInstagramForPage(cred, page.pageId);
    if (igLink) {
      summary.instagramAccounts.discovered++;
      const igResult = await upsertDiscoveredResource(
        serviceSb,
        "workspace_instagram_accounts",
        "ig_business_account_id",
        igLink.igBusinessAccountId,
        workspaceId,
        {
          workspace_id: workspaceId,
          integration_id: integrationId,
          ig_business_account_id: igLink.igBusinessAccountId,
          username: igLink.username,
          linked_facebook_page_id: result.id,
        },
        { username: igLink.username, linked_facebook_page_id: result.id },
      );
      if (igResult.collision) {
        summary.instagramAccounts.collisions++;
        summary.collisionDetails.push({ table: "workspace_instagram_accounts", providerId: igLink.igBusinessAccountId });
      } else if (igResult.wasNew) {
        summary.instagramAccounts.new++;
      }
    }
  }

  const adAccounts = mockMode ? MOCK_META_AD_ACCOUNTS : await fetchAdAccounts(cred);
  summary.adAccounts.discovered = adAccounts.length;
  for (const acct of adAccounts) {
    const result = await upsertDiscoveredResource(
      serviceSb,
      "workspace_meta_ad_accounts",
      "ad_account_id",
      acct.adAccountId,
      workspaceId,
      { workspace_id: workspaceId, integration_id: integrationId, ad_account_id: acct.adAccountId, name: acct.name, currency: acct.currency },
      { name: acct.name, currency: acct.currency },
    );
    if (result.collision) {
      summary.adAccounts.collisions++;
      summary.collisionDetails.push({ table: "workspace_meta_ad_accounts", providerId: acct.adAccountId });
    } else if (result.wasNew) {
      summary.adAccounts.new++;
    }
  }

  return summary;
}

export async function discoverAndStoreWhatsAppResources(
  serviceSb: AnySupabaseClient,
  workspaceId: string,
  integrationId: string,
  cred: MetaCredential,
  mockMode: boolean,
): Promise<DiscoverySummary> {
  const summary: DiscoverySummary = {
    facebookPages: { discovered: 0, new: 0, collisions: 0 },
    instagramAccounts: { discovered: 0, new: 0, collisions: 0 },
    adAccounts: { discovered: 0, new: 0, collisions: 0 },
    whatsappNumbers: { discovered: 0, new: 0, collisions: 0 },
    collisionDetails: [],
  };

  let numbers = mockMode ? MOCK_WHATSAPP_NUMBERS : [];
  if (!mockMode) {
    const businesses = await fetchBusinesses(cred);
    for (const business of businesses) {
      const wabas = await fetchOwnedWabas(cred, business.id);
      for (const waba of wabas) {
        numbers = numbers.concat(await fetchWabaPhoneNumbers(cred, waba.id));
      }
    }
  }

  summary.whatsappNumbers.discovered = numbers.length;
  for (const num of numbers) {
    const result = await upsertDiscoveredResource(
      serviceSb,
      "workspace_whatsapp_numbers",
      "phone_number_id",
      num.phoneNumberId,
      workspaceId,
      {
        workspace_id: workspaceId,
        integration_id: integrationId,
        phone_number_id: num.phoneNumberId,
        display_phone_number: num.displayPhoneNumber,
        waba_id: num.wabaId,
        verified_name: num.verifiedName,
        quality_rating: num.qualityRating,
        platform_status: num.platformStatus,
      },
      { display_phone_number: num.displayPhoneNumber, waba_id: num.wabaId, verified_name: num.verifiedName, quality_rating: num.qualityRating, platform_status: num.platformStatus },
    );
    if (result.collision) {
      summary.whatsappNumbers.collisions++;
      summary.collisionDetails.push({ table: "workspace_whatsapp_numbers", providerId: num.phoneNumberId });
    } else if (result.wasNew) {
      summary.whatsappNumbers.new++;
    }
  }

  return summary;
}
