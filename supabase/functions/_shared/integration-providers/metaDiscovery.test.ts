import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseAdAccountsResponse, parseFacebookPagesResponse, parseInstagramLinkResponse } from "./metaDiscovery.ts";

Deno.test("parseFacebookPagesResponse normalizes id/name and handles an empty result", () => {
  assertEquals(parseFacebookPagesResponse({ data: [{ id: "111", name: "Acapolite Consulting" }, { id: "222", name: "Tax Coach SA" }] }), [
    { pageId: "111", pageName: "Acapolite Consulting" },
    { pageId: "222", pageName: "Tax Coach SA" },
  ]);
  assertEquals(parseFacebookPagesResponse({}), []);
  assertEquals(parseFacebookPagesResponse({ data: [] }), []);
});

Deno.test("parseInstagramLinkResponse returns null when the Page has no linked Instagram account (not every Page has one)", () => {
  assertEquals(parseInstagramLinkResponse({}, "page-1"), null);
});

Deno.test("parseInstagramLinkResponse normalizes the linked account and stamps which Page it came from", () => {
  assertEquals(parseInstagramLinkResponse({ instagram_business_account: { id: "ig-1", username: "acapoliteconsulting" } }, "page-1"), {
    igBusinessAccountId: "ig-1",
    username: "acapoliteconsulting",
    linkedPageId: "page-1",
  });
});

Deno.test("parseInstagramLinkResponse tolerates a missing username (some accounts return none)", () => {
  assertEquals(parseInstagramLinkResponse({ instagram_business_account: { id: "ig-1" } }, "page-1"), {
    igBusinessAccountId: "ig-1",
    username: null,
    linkedPageId: "page-1",
  });
});

Deno.test("parseAdAccountsResponse strips the act_ prefix (Meta's raw id) so the stored ad_account_id is the bare numeric id", () => {
  assertEquals(
    parseAdAccountsResponse({ data: [{ id: "act_1234567890", name: "Acapolite Ads", currency: "ZAR", timezone_name: "Africa/Johannesburg", account_status: 1 }] }),
    [{ adAccountId: "1234567890", name: "Acapolite Ads", currency: "ZAR", timezone: "Africa/Johannesburg", accountStatus: 1 }],
  );
});

Deno.test("parseAdAccountsResponse tolerates missing optional fields", () => {
  assertEquals(parseAdAccountsResponse({ data: [{ id: "act_1" }] }), [
    { adAccountId: "1", name: null, currency: null, timezone: null, accountStatus: null },
  ]);
});
