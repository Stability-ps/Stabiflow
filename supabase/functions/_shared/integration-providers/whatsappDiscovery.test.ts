import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseBusinessesResponse, parseOwnedWabasResponse, parseWabaPhoneNumbersResponse } from "./whatsappDiscovery.ts";

Deno.test("parseBusinessesResponse normalizes id/name and handles an empty result", () => {
  assertEquals(parseBusinessesResponse({ data: [{ id: "biz-1", name: "Acapolite Consulting" }] }), [{ id: "biz-1", name: "Acapolite Consulting" }]);
  assertEquals(parseBusinessesResponse({}), []);
});

Deno.test("parseOwnedWabasResponse normalizes owned WhatsApp Business Accounts", () => {
  assertEquals(parseOwnedWabasResponse({ data: [{ id: "waba-1", name: "Acapolite WABA" }] }), [{ id: "waba-1", name: "Acapolite WABA" }]);
});

Deno.test("parseWabaPhoneNumbersResponse stamps every number with the WABA id it came from - a workspace may have several numbers under one WABA", () => {
  const result = parseWabaPhoneNumbersResponse(
    {
      data: [
        { id: "num-1", display_phone_number: "+27 82 000 0001", verified_name: "Acapolite Consulting", quality_rating: "GREEN", code_verification_status: "VERIFIED" },
        { id: "num-2", display_phone_number: "+27 82 000 0002" },
      ],
    },
    "waba-1",
  );
  assertEquals(result, [
    { wabaId: "waba-1", phoneNumberId: "num-1", displayPhoneNumber: "+27 82 000 0001", verifiedName: "Acapolite Consulting", qualityRating: "GREEN", platformStatus: "VERIFIED" },
    { wabaId: "waba-1", phoneNumberId: "num-2", displayPhoneNumber: "+27 82 000 0002", verifiedName: null, qualityRating: null, platformStatus: null },
  ]);
});

Deno.test("parseWabaPhoneNumbersResponse handles an empty result (WABA exists, no numbers yet)", () => {
  assertEquals(parseWabaPhoneNumbersResponse({}, "waba-1"), []);
});
