import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildContactLine, parseContactFields, resolveBrandSnapshot, type BrandSnapshot } from "./brandSnapshot.ts";

function chainable(resolved: { data: unknown; error: unknown }) {
  return { eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(resolved) }), maybeSingle: () => Promise.resolve(resolved) }) };
}

function makeClient(rows: Record<string, { data: unknown; error: unknown }>) {
  return {
    from: (table: string) => ({
      select: () => chainable(rows[table] ?? { data: null, error: null }),
    }),
  };
}

Deno.test("resolveBrandSnapshot: resolves from an explicit brand profile", async () => {
  const client = makeClient({
    creative_brand_profiles: {
      data: {
        id: "profile-1",
        workspace_id: "ws-1",
        company_name: "Acme Co",
        logo_media_asset_id: "asset-1",
        primary_color: "#111111",
        secondary_color: "#222222",
        accent_color: "#333333",
        cta_text_color: "#ffffff",
        contact_phone: "+27821234567",
        whatsapp_number: "+27821234567",
        contact_email: "hi@acme.co",
        website: "https://acme.co",
        address: "1 Main Rd",
        default_cta: "Get a quote",
        footer_disclaimer: "Terms apply",
      },
      error: null,
    },
  });
  const result = await resolveBrandSnapshot(client, "ws-1", "profile-1");
  if ("error" in result) throw new Error("expected success");
  assertEquals(result.resolvedProfileId, "profile-1");
  assertEquals(result.snapshot.name, "Acme Co");
  assertEquals(result.snapshot.logoMediaAssetId, "asset-1");
  assertEquals(result.snapshot.logoPath, null);
  assertEquals(result.snapshot.primary, "#111111");
  assertEquals(result.snapshot.whatsapp, "+27821234567");
});

Deno.test("resolveBrandSnapshot: rejects a profile belonging to a different workspace", async () => {
  const client = makeClient({
    creative_brand_profiles: { data: { id: "profile-1", workspace_id: "OTHER-WORKSPACE", company_name: "Acme" }, error: null },
  });
  const result = await resolveBrandSnapshot(client, "ws-1", "profile-1");
  if (!("error" in result)) throw new Error("expected an error result");
  assertEquals(typeof result.error, "string");
});

Deno.test("resolveBrandSnapshot: falls back to legacy workspace_settings when no profile id given", async () => {
  const client = makeClient({
    workspaces: { data: { name: "Legacy Workspace" }, error: null },
    workspace_settings: {
      data: {
        logo_path: "ws-1/logo.png",
        brand_primary_color: "#abcabc",
        secondary_brand_color: null,
        brand_accent_color: null,
        brand_cta_text_color: null,
        ad_footer_disclaimer: null,
        default_ad_cta: "Learn more",
        contact_email: "legacy@acme.co",
        contact_phone: null,
        website: null,
      },
      error: null,
    },
  });
  const result = await resolveBrandSnapshot(client, "ws-1", null);
  if ("error" in result) throw new Error("expected success");
  assertEquals(result.resolvedProfileId, null);
  assertEquals(result.snapshot.name, "Legacy Workspace");
  assertEquals(result.snapshot.logoPath, "ws-1/logo.png");
  assertEquals(result.snapshot.logoMediaAssetId, null);
  assertEquals(result.snapshot.whatsapp, null);
  assertEquals(result.snapshot.defaultCta, "Learn more");
});

Deno.test("parseContactFields: defaults to phone/whatsapp/website when absent or invalid", () => {
  assertEquals(parseContactFields(undefined), ["phone", "whatsapp", "website"]);
  assertEquals(parseContactFields(["not-a-field"]), ["phone", "whatsapp", "website"]);
  assertEquals(parseContactFields(["email", "address"]), ["email", "address"]);
});

Deno.test("buildContactLine: joins only the selected, present fields in order", () => {
  const snapshot: BrandSnapshot = {
    name: "Acme",
    logoMediaAssetId: null,
    logoPath: null,
    primary: null,
    secondary: null,
    accent: null,
    ctaText: null,
    contactPhone: "0821234567",
    whatsapp: "0821234567",
    contactEmail: "hi@acme.co",
    website: "acme.co",
    address: "1 Main Rd",
    defaultCta: null,
    footerDisclaimer: null,
  };
  assertEquals(buildContactLine(snapshot, ["phone", "website"]), "0821234567 · acme.co");
  assertEquals(buildContactLine(snapshot, ["email"]), "hi@acme.co");
  assertEquals(buildContactLine({ ...snapshot, contactPhone: null }, ["phone"]), null);
});
