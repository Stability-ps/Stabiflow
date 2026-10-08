import { describe, expect, it } from "vitest";
import {
  attributionBand, breakdownRemainder, buildJourneyStages, hasAnyJourneyData, journeyHeadline,
  toFunnel, type CampaignJourneyRow,
} from "./campaignJourney";

function row(overrides: Partial<CampaignJourneyRow> = {}): CampaignJourneyRow {
  return {
    campaign_id: "c1",
    name: "Spring",
    status: "active",
    currency: "ZAR",
    metrics_available: true,
    spend_minor: 100_00,
    impressions: 5000,
    reach: 4000,
    clicks: 200,
    conversations: 40,
    conversations_direct: 30,
    conversations_inferred: 10,
    leads: 20,
    leads_direct: 14,
    leads_inferred: 6,
    qualified_leads: 12,
    opportunities: 8,
    opportunities_direct: 5,
    opportunities_inferred: 3,
    customers: 4,
    customers_direct: 3,
    customers_inferred: 1,
    revenue: [{ currency: "ZAR", amount_minor: 800_00 }],
    adset_breakdown: [],
    ad_breakdown: [],
    creative_breakdown: [],
    ...overrides,
  };
}

describe("buildJourneyStages — order & semantics (audit M6)", () => {
  it("orders Conversations -> Leads -> Qualified -> Opportunities -> Customers", () => {
    expect(buildJourneyStages(row()).map((s) => s.key)).toEqual([
      "conversations", "leads", "qualified_leads", "opportunities", "customers",
    ]);
  });

  it("Qualified's conversion is qualified / leads (a state of a lead), not qualified / conversations", () => {
    const q = buildJourneyStages(row())[2];
    expect(q.key).toBe("qualified_leads");
    expect(q.previousLabel).toBe("Leads");
    // 12 / 20 = 60%
    expect(q.rateFromPrevious).toBeCloseTo(60);
  });

  it("Leads' conversion is leads / conversations, labelled 'of Conversations'", () => {
    const l = buildJourneyStages(row())[1];
    expect(l.previousLabel).toBe("Conversations");
    expect(l.rateFromPrevious).toBeCloseTo(50); // 20/40
  });

  it("direct + inferred always equals the stage total (from the RPC's own split)", () => {
    for (const s of buildJourneyStages(row())) {
      if (!s.bands) continue;
      expect(s.bands.direct + s.bands.inferred).toBe(s.count);
    }
  });

  it("Qualified carries no direct/inferred band (a state, not a touch population)", () => {
    expect(buildJourneyStages(row())[2].bands).toBeNull();
  });
});

describe("cost / rate: unavailable vs measured-zero (audit HIGH-4 / rule 16)", () => {
  it("metrics_available = false => every spend-derived cost is null (rendered '—'), counts are untouched", () => {
    const stages = buildJourneyStages(row({ metrics_available: false }));
    for (const s of stages) expect(s.costPerMinor).toBeNull();
    const h = journeyHeadline(row({ metrics_available: false }));
    expect(h.costPerClickMinor).toBeNull();
    expect(h.cacMinor).toBeNull();
    expect(h.roas.status).toBe("unavailable");
    // counts survive
    expect(stages.find((s) => s.key === "customers")!.count).toBe(4);
  });

  it("metrics_available = true, spend = 0, count > 0 => cost is a real measured 0, not null", () => {
    const s = buildJourneyStages(row({ metrics_available: true, spend_minor: 0 }));
    expect(s.find((x) => x.key === "leads")!.costPerMinor).toBe(0);
  });

  it("cost is null when the count is 0 even with real spend", () => {
    const s = buildJourneyStages(row({ customers: 0, customers_direct: 0, customers_inferred: 0 }));
    expect(s.find((x) => x.key === "customers")!.costPerMinor).toBeNull();
    expect(journeyHeadline(row({ customers: 0 })).cacMinor).toBeNull();
  });

  it("a measured 0 with a non-zero previous stage is a real 0% rate, never null", () => {
    const s = buildJourneyStages(row({ conversations: 30, leads: 0 }));
    expect(s.find((x) => x.key === "leads")!.rateFromPrevious).toBe(0);
  });
});

describe("journeyHeadline — currency safety (§11)", () => {
  it("ROAS is 'mixed_currency' when spend currency != revenue currency, never converted", () => {
    const h = journeyHeadline(row({ currency: "ZAR", revenue: [{ currency: "USD", amount_minor: 500_00 }] }));
    expect(h.roas.status).toBe("mixed_currency");
  });
  it("ROAS is unavailable when there is no revenue", () => {
    expect(journeyHeadline(row({ revenue: [] })).roas.status).toBe("unavailable");
  });
});

describe("attributionBand", () => {
  it("deterministic / exact_match => direct; everything else (incl. null) => inferred, never direct", () => {
    expect(attributionBand("deterministic")).toBe("direct");
    expect(attributionBand("exact_match")).toBe("direct");
    expect(attributionBand("provider_reported")).toBe("inferred");
    expect(attributionBand("manual")).toBe("inferred");
    expect(attributionBand(null)).toBe("inferred");
    expect(attributionBand(undefined)).toBe("inferred");
  });
});

describe("breakdownRemainder", () => {
  it("is stage total minus the sum of breakdown rows, floored at 0", () => {
    const rows = [
      { id: "a", conversations: 5, leads: 3, opportunities: 1, customers: 0 },
      { id: "b", conversations: 4, leads: 2, opportunities: 0, customers: 0 },
    ];
    expect(breakdownRemainder(12, rows, "conversations")).toBe(3); // 12 - 9
    expect(breakdownRemainder(4, rows, "leads")).toBe(0); // 4 - 5 -> floored
  });
});

describe("hasAnyJourneyData", () => {
  it("false for null / everything zero-and-unsynced", () => {
    expect(hasAnyJourneyData(null)).toBe(false);
    expect(hasAnyJourneyData(toFunnel(row({
      metrics_available: false, spend_minor: 0, clicks: 0,
      conversations: 0, leads: 0, opportunities: 0, customers: 0, revenue: [],
    })))).toBe(false);
  });
  it("true when there are conversions even if metrics never synced", () => {
    expect(hasAnyJourneyData(toFunnel(row({
      metrics_available: false, spend_minor: 0, clicks: 0,
      conversations: 3, leads: 0, opportunities: 0, customers: 0, revenue: [],
    })))).toBe(true);
  });
  it("unsynced spend/clicks alone do NOT count as data (they are not real yet)", () => {
    expect(hasAnyJourneyData(toFunnel(row({
      metrics_available: false, spend_minor: 999, clicks: 999,
      conversations: 0, leads: 0, opportunities: 0, customers: 0, revenue: [],
    })))).toBe(false);
  });
});
