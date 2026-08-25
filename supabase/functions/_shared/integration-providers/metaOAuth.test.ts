import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildMetaAuthorizeUrl, META_SCOPES, scopesForProvider, WHATSAPP_SCOPES } from "./metaOAuth.ts";

Deno.test("buildMetaAuthorizeUrl points at the versioned Facebook OAuth dialog with all required params", () => {
  const url = buildMetaAuthorizeUrl({
    appId: "APP_ID_123",
    apiVersion: "v21.0",
    redirectUri: "https://api.example.com/functions/v1/integrations-meta-oauth-callback",
    state: "abc123",
    provider: "meta",
  });
  const parsed = new URL(url);
  assertEquals(parsed.origin, "https://www.facebook.com");
  assertEquals(parsed.pathname, "/v21.0/dialog/oauth");
  assertEquals(parsed.searchParams.get("client_id"), "APP_ID_123");
  assertEquals(parsed.searchParams.get("redirect_uri"), "https://api.example.com/functions/v1/integrations-meta-oauth-callback");
  assertEquals(parsed.searchParams.get("state"), "abc123");
  assertEquals(parsed.searchParams.get("response_type"), "code");
});

Deno.test("meta provider requests the Meta scope set (pages/instagram/ads), not the WhatsApp set", () => {
  const url = new URL(buildMetaAuthorizeUrl({ appId: "a", apiVersion: "v21.0", redirectUri: "https://x", state: "s", provider: "meta" }));
  const scope = url.searchParams.get("scope") || "";
  assertEquals(scope.includes("pages_manage_posts"), true);
  assertEquals(scope.includes("instagram_content_publish"), true);
  assertEquals(scope.includes("ads_management"), true);
  assertEquals(scope.includes("whatsapp_business_messaging"), false);
});

Deno.test("whatsapp provider requests the WhatsApp scope set only", () => {
  const url = new URL(buildMetaAuthorizeUrl({ appId: "a", apiVersion: "v21.0", redirectUri: "https://x", state: "s", provider: "whatsapp" }));
  const scope = url.searchParams.get("scope") || "";
  assertEquals(scope.includes("whatsapp_business_management"), true);
  assertEquals(scope.includes("pages_manage_posts"), false);
});

Deno.test("scopesForProvider is exhaustive and the two scope sets share no accidental overlap that would leak ads permission into a whatsapp-only connect", () => {
  assertNotEquals(scopesForProvider("meta"), scopesForProvider("whatsapp"));
  assertEquals(META_SCOPES.some((s) => WHATSAPP_SCOPES.includes(s)), false);
});
