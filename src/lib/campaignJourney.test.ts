import { describe, expect, it } from "vitest";
import {
  attributionBand, breakdownBy, buildJourneyStages, hasAnyJourneyData, journeyHeadline,
  stageEntityIds, tallyBands, type JourneyDrillRow, type JourneyFunnel,
} from "./campaignJourney";

function funnel(overrides: Partial<JourneyFunnel> = {}): JourneyFunnel {
  return {
    spend_minor: 100_00,
    currency: "ZAR",
    impressions: 5000,
    reach: 4000,
    clicks: 200,
    conversations: 40,
    qualified_leads: 12,
    leads: 20,
    opportunities: 8,
    customers: 4,
    revenue: [{ currency: "ZAR", amount_minor: 800_00 }],
    ...overrides,
  };
}

describe("buildJourneyStages", () => {
  it("computes cost-per-stage and stage-to-stage rate from real counts", () => {
    const stages = buildJourneyStages(funnel());
    const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
    expect(byKey.conversations.costPerMinor).toBe(100_00 / 40);
    expect(byKey.leads.costPerMinor).toBe(100_00 / 20);
    // leads / conversations = 20 / 40 = 50%
    expect(byKey.leads.rateFromPrevious).toBeCloseTo(50);
    // customers / opportunities = 4 / 8 = 50%
    expect(byKey.customers.rateFromPrevious).toBeCloseTo(50);
  });

  it("returns null (not 0) for cost/rate when the divisor is 0 - unavailable vs measured-zero", () => {
    const stages = buildJourneyStages(funnel({ leads: 0, opportunities: 0, customers: 0, conversations: 10 }));
    const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
    // 0 leads -> cost per lead is not computable
    expect(byKey.leads.costPerMinor).toBeNull();
    // opportunities rate is from leads (0) -> null
    expect(byKey.opportunities.rateFromPrevious).toBeNull();
    // but the COUNT of 0 is preserved as a real number
    expect(byKey.leads.count).toBe(0);
  });

  it("a measured zero with a non-zero divisor yields a real 0% rate, never null", () => {
    const stages = buildJourneyStages(funnel({ conversations: 30, leads: 0 }));
    const leads = stages.find((s) => s.key === "leads")!;
    expect(leads.rateFromPrevious).toBe(0);
  });
});

describe("journeyHeadline", () => {
  it("computes CAC, cost-per-click, and conversation->customer rate", () => {
    const h = journeyHeadline(funnel());
    expect(h.cacMinor).toBe(100_00 / 4);
    expect(h.costPerClickMinor).toBe(100_00 / 200);
    expect(h.conversationToCustomerRate).toBeCloseTo(10); // 4/40
    expect(h.leadToCustomerRate).toBeCloseTo(20); // 4/20
  });

  it("CAC is null when there are no customers", () => {
    expect(journeyHeadline(funnel({ customers: 0 })).cacMinor).toBeNull();
  });
});

describe("attributionBand", () => {
  it("maps deterministic / exact_match to direct", () => {
    expect(attributionBand("deterministic")).toBe("direct");
    expect(attributionBand("exact_match")).toBe("direct");
  });
  it("maps provider_reported and anything unknown (incl. null) to inferred", () => {
    expect(attributionBand("provider_reported")).toBe("inferred");
    expect(attributionBand("manual")).toBe("inferred");
    expect(attributionBand(null)).toBe("inferred");
    expect(attributionBand(undefined)).toBe("inferred");
  });
});

describe("tallyBands", () => {
  it("splits a set of crediting rows into direct vs inferred", () => {
    const split = tallyBands([
      { attribution_method: "deterministic" },
      { attribution_method: "deterministic" },
      { attribution_method: "provider_reported" },
      { attribution_method: null },
    ]);
    expect(split).toEqual({ direct: 2, inferred: 2 });
  });
});

describe("breakdownBy", () => {
  const rows: JourneyDrillRow[] = [
    { attribution_method: "deterministic", ad_set_id: "as1", ad_id: "a1", creative_id: "c1", conversation_id: "conv1", lead_id: "l1", opportunity_id: null, customer_id: null },
    { attribution_method: "deterministic", ad_set_id: "as1", ad_id: "a1", creative_id: "c1", conversation_id: "conv1", lead_id: "l1", opportunity_id: "o1", customer_id: null },
    { attribution_method: "provider_reported", ad_set_id: "as2", ad_id: "a2", creative_id: "c1", conversation_id: "conv2", lead_id: null, opportunity_id: null, customer_id: null },
  ];

  it("counts each distinct entity once per group", () => {
    const bySet = breakdownBy(rows, "ad_set_id");
    const as1 = bySet.find((r) => r.id === "as1")!;
    expect(as1.conversations).toBe(1); // conv1 seen twice, counted once
    expect(as1.leads).toBe(1);
    expect(as1.opportunities).toBe(1);
    const as2 = bySet.find((r) => r.id === "as2")!;
    expect(as2.conversations).toBe(1);
    expect(as2.leads).toBe(0);
  });

  it("aggregates across ad sets when grouping by creative", () => {
    const byCreative = breakdownBy(rows, "creative_id");
    const c1 = byCreative.find((r) => r.id === "c1")!;
    expect(c1.conversations).toBe(2); // conv1 + conv2
  });

  it("ignores rows with a null group id", () => {
    const withNull = breakdownBy([{ ...rows[0], ad_set_id: null }], "ad_set_id");
    expect(withNull).toEqual([]);
  });
});

describe("stageEntityIds", () => {
  const rows: JourneyDrillRow[] = [
    { attribution_method: "deterministic", ad_set_id: null, ad_id: null, creative_id: null, conversation_id: "conv1", lead_id: "l1", opportunity_id: null, customer_id: null },
    { attribution_method: "provider_reported", ad_set_id: null, ad_id: null, creative_id: null, conversation_id: "conv1", lead_id: "l1", opportunity_id: "o1", customer_id: "cust1" },
  ];
  it("returns distinct ids for the stage, each with a crediting method", () => {
    expect(stageEntityIds(rows, "conversations").map((e) => e.id)).toEqual(["conv1"]);
    expect(stageEntityIds(rows, "leads").map((e) => e.id)).toEqual(["l1"]);
    expect(stageEntityIds(rows, "opportunities")).toEqual([{ id: "o1", method: "provider_reported" }]);
    expect(stageEntityIds(rows, "customers")).toEqual([{ id: "cust1", method: "provider_reported" }]);
  });
  it("qualified_leads keys off lead_id, same as leads", () => {
    expect(stageEntityIds(rows, "qualified_leads").map((e) => e.id)).toEqual(["l1"]);
  });
});

describe("hasAnyJourneyData", () => {
  it("false for null / all-zero, true when any signal exists", () => {
    expect(hasAnyJourneyData(null)).toBe(false);
    expect(hasAnyJourneyData(funnel({ spend_minor: 0, clicks: 0, conversations: 0, leads: 0, opportunities: 0, customers: 0, revenue: [] }))).toBe(false);
    expect(hasAnyJourneyData(funnel({ spend_minor: 0, clicks: 0, conversations: 1, leads: 0, opportunities: 0, customers: 0, revenue: [] }))).toBe(true);
  });
});
