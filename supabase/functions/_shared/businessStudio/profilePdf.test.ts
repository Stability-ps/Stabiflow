import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { onColor, renderProfilePdf, sanitize, wrapText } from "./profilePdf.ts";
import { buildProfileContent, profileSections } from "./profileContent.ts";

const base = {
  identity: { trading_name: "Acme", legal_name: "Acme (Pty) Ltd", long_description: "About.", core_values: [] },
  contacts: [{ kind: "email", value: "hi@acme.co.za", is_primary: true }, { kind: "phone", value: "011", is_public: false }],
  locations: [], socialLinks: [], offerings: [{ name: "Welding" }, { name: "Rejected", verification_status: "rejected" }],
  team: [], projects: [], certifications: [],
  identifiers: [{ scheme: "za_vat", value: "4123", is_public: false }, { scheme: "za_cipc_registration", value: "2004/1/07", is_public: true }],
  brand: { primary_color: "#0F3D5C", accent_color: "not-a-colour" }, hasLogo: false,
};

Deno.test("content includes only public, non-rejected facts and falls back on invalid colours", () => {
  const c = buildProfileContent(base);
  assertEquals(c.contacts.map((x) => x.kind), ["email"]);
  assertEquals(c.offerings.map((o) => o.name), ["Welding"]);
  assertEquals(c.identifiers, [{ label: "Company registration", value: "2004/1/07" }]);
  assertEquals(c.brand.primary, "#0F3D5C");
  assertEquals(c.brand.accent, "#E0A526");
});

Deno.test("empty sections are omitted, never padded", () => {
  const c = buildProfileContent(base);
  assertEquals(profileSections(c), ["cover", "about", "offerings", "credentials", "contact"]);
});

Deno.test("sanitize keeps WinAnsi-safe text only", () => {
  assertEquals(sanitize("Café “quotes” — m² \u{1F680} emoji"), "Cafe \"quotes\" - m2 emoji");
});

Deno.test("wrapText respects the width and hard-splits very long words", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = wrapText("short words here " + "x".repeat(300), font, 10, 200);
  assert(lines.every((l) => font.widthOfTextAtSize(l, 10) <= 200));
  assert(lines.length > 3);
});

Deno.test("onColor picks readable text on light and dark fills", () => {
  assertEquals(onColor("#0F3D5C").red, 1);
  assert(onColor("#FFF7CC").red < 0.2);
});

Deno.test("render produces a valid A4 PDF for every layout, watermarked or not", async () => {
  const c = buildProfileContent({ ...base, identity: { ...base.identity, long_description: "Paragraph. ".repeat(600) } });
  for (const layout of ["band", "sidebar", "minimal"] as const) {
    for (const watermark of [false, true]) {
      const { bytes, pageCount } = await renderProfilePdf(c, { layout, headingFont: "serif", watermark });
      const doc = await PDFDocument.load(bytes);
      assertEquals(doc.getPageCount(), pageCount);
      assert(pageCount >= 3, "long content flows onto extra pages");
      const { width, height } = doc.getPage(0).getSize();
      assertEquals([Math.round(width), Math.round(height)], [595, 842]);
    }
  }
});

Deno.test("an unreadable logo never fails the render", async () => {
  const c = buildProfileContent({ ...base, hasLogo: true });
  const { pageCount } = await renderProfilePdf(c, { layout: "band", headingFont: "sans", watermark: false, logo: { bytes: new Uint8Array([1, 2, 3]), type: "png" } });
  assert(pageCount >= 2);
});
