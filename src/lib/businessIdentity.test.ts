import { describe, expect, it } from "vitest";
import { computeCompleteness, identifierSchemeLabel, type BusinessIdentityBundle } from "./businessIdentity";

function bundle(over: Partial<BusinessIdentityBundle> = {}, identity: Record<string, unknown> = {}): BusinessIdentityBundle {
  return {
    identity: {
      id: "i1", workspace_id: "w1", legal_name: null, trading_name: null, country_code: "ZA", website: null, industry: null,
      tagline: null, short_description: null, long_description: null, mission: null, vision: null, core_values: [],
      founded_year: null, employee_count_range: null, brand_profile_id: null, field_provenance: {}, verification_status: "unverified",
      verified_at: null, verified_by: null, created_at: "", updated_at: "", ...identity,
    } as BusinessIdentityBundle["identity"],
    contacts: [], locations: [], socialLinks: [], offerings: [], team: [], projects: [], certifications: [], identifiers: [],
    ...over,
  };
}

describe("computeCompleteness", () => {
  it("is 0 for an empty identity and lists every gap", () => {
    const r = computeCompleteness(bundle());
    expect(r.score).toBe(0);
    expect(r.items.every((i) => !i.done)).toBe(true);
  });

  it("treats whitespace-only text as missing", () => {
    const r = computeCompleteness(bundle({}, { trading_name: "   " }));
    expect(r.items.find((i) => i.key === "name")?.done).toBe(false);
  });

  it("requires at least three offerings", () => {
    const two = computeCompleteness(bundle({ offerings: [{}, {}] as never }));
    const three = computeCompleteness(bundle({ offerings: [{}, {}, {}] as never }));
    expect(two.items.find((i) => i.key === "offerings")?.done).toBe(false);
    expect(three.items.find((i) => i.key === "offerings")?.done).toBe(true);
    expect(three.score).toBeGreaterThan(two.score);
  });

  it("reaches 100 when everything is filled", () => {
    const r = computeCompleteness(
      bundle(
        {
          contacts: [{ kind: "email" }] as never, locations: [{}] as never, offerings: [{}, {}, {}] as never,
          socialLinks: [{}] as never, team: [{}] as never, projects: [{}] as never, certifications: [{}] as never,
        },
        {
          trading_name: "Acme", legal_name: "Acme (Pty) Ltd", industry: "Engineering", website: "https://acme.example",
          short_description: "We build.", long_description: "Long.", mission: "M", core_values: ["Integrity"], brand_profile_id: "bp",
        },
      ),
    );
    expect(r.score).toBe(100);
  });
});

describe("identifierSchemeLabel", () => {
  it("labels known South African schemes and falls back gracefully", () => {
    expect(identifierSchemeLabel("ZA", "za_vat")).toBe("VAT number");
    expect(identifierSchemeLabel("GB", "companies_house")).toBe("companies house");
  });
});
