import { describe, expect, it } from "vitest";
import { createOpportunityActionLabel, getOpportunityLabel, openOpportunityActionLabel, pluralizeLabel } from "./terminology";

describe("getOpportunityLabel", () => {
  it("defaults to Opportunity when no terminology is configured", () => {
    expect(getOpportunityLabel(null)).toBe("Opportunity");
    expect(getOpportunityLabel({})).toBe("Opportunity");
    expect(getOpportunityLabel({ opportunity_label: "   " })).toBe("Opportunity");
  });

  it("uses the workspace's configured label without touching the schema", () => {
    expect(getOpportunityLabel({ opportunity_label: "Request" })).toBe("Request");
    expect(getOpportunityLabel({ opportunity_label: "Deal" })).toBe("Deal");
  });
});

describe("action label helpers", () => {
  it("builds the default action labels", () => {
    expect(openOpportunityActionLabel(null)).toBe("Open Opportunity");
    expect(createOpportunityActionLabel(null)).toBe("Create Opportunity");
  });

  it("builds terminology-aware action labels (e.g. a tax/accounting workspace)", () => {
    expect(openOpportunityActionLabel({ opportunity_label: "Request" })).toBe("Open Request");
    expect(createOpportunityActionLabel({ opportunity_label: "Booking" })).toBe("Create Booking");
  });
});

describe("pluralizeLabel", () => {
  it("turns a consonant+y ending into ies, not a bare + s", () => {
    expect(pluralizeLabel("Opportunity")).toBe("Opportunities");
  });

  it("adds es after s/x/z/ch/sh endings", () => {
    expect(pluralizeLabel("Case")).toBe("Cases"); // ends in e, not the es-trigger set - plain +s
    expect(pluralizeLabel("Match")).toBe("Matches");
    expect(pluralizeLabel("Box")).toBe("Boxes");
  });

  it("adds a plain s for the regular case", () => {
    expect(pluralizeLabel("Request")).toBe("Requests");
    expect(pluralizeLabel("Deal")).toBe("Deals");
    expect(pluralizeLabel("Booking")).toBe("Bookings"); // vowel+y - regular +s, not +ies
  });
});
