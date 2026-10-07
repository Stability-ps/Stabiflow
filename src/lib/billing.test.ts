import { describe, expect, it } from "vitest";
import { entitlementLabel } from "./billing";

describe("entitlementLabel", () => {
  it("uses the catalogue name when there is one", () => {
    expect(entitlementLabel("team_seats", { team_seats: "Team members" })).toBe("Team members");
  });

  it("falls back to a readable version of the key", () => {
    expect(entitlementLabel("whatsapp_ai_turns", undefined)).toBe("Whatsapp ai turns");
    expect(entitlementLabel("business_profile.pdf_export", {})).toBe("Business profile pdf export");
  });
});
