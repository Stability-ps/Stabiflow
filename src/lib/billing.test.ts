import { describe, expect, it } from "vitest";
import { entitlementLabel, planSummaryLabel, summarizePlan } from "./billing";

describe("entitlementLabel", () => {
  it("uses the catalogue name when there is one", () => {
    expect(entitlementLabel("team_seats", { team_seats: "Team members" })).toBe("Team members");
  });

  it("falls back to a readable version of the key", () => {
    expect(entitlementLabel("whatsapp_ai_turns", undefined)).toBe("Whatsapp ai turns");
    expect(entitlementLabel("business_profile.pdf_export", {})).toBe("Business profile pdf export");
  });
});

describe("summarizePlan (sidebar plan label)", () => {
  const sub = { id: "s", status: "active", current_period_end: null, grace_until: null, cancel_at_period_end: false, plan: { code: "growth", name: "Growth" }, price: null };
  const purchase = (name: string, rank: number) => ({ id: name, status: "paid", paid_at: null, access_expires_at: null, plan: { code: name.toLowerCase(), name, tier_rank: rank } });

  it("never reports Free while loading or after a failed load", () => {
    expect(summarizePlan(undefined, { isLoading: true, isError: false })).toEqual({ status: "loading" });
    expect(summarizePlan(undefined, { isLoading: false, isError: true })).toEqual({ status: "unavailable" });
    expect(planSummaryLabel({ status: "loading" })).toBe("Checking plan…");
    expect(planSummaryLabel({ status: "unavailable" })).toBe("Plan unavailable");
  });

  it("reports Free only when loaded state has no subscription and no purchase", () => {
    expect(summarizePlan({ subscription: null, purchases: [] }, { isLoading: false, isError: false })).toEqual({ status: "free" });
    expect(planSummaryLabel({ status: "free" })).toBe("Free plan");
  });

  it("prefers the subscription, then the highest-tier purchase - the Billing page's rule", () => {
    expect(summarizePlan({ subscription: sub, purchases: [purchase("Business", 1)] }, { isLoading: false, isError: false })).toEqual({ status: "paid", name: "Growth" });
    expect(summarizePlan({ subscription: null, purchases: [purchase("Starter", 1), purchase("Business", 2)] }, { isLoading: false, isError: false })).toEqual({ status: "paid", name: "Business" });
  });

  it("keeps showing the last known plan if a background refresh fails", () => {
    expect(summarizePlan({ subscription: sub, purchases: [] }, { isLoading: false, isError: true })).toEqual({ status: "paid", name: "Growth" });
  });

  it("a paid plan with no readable name is 'Paid plan', not Free", () => {
    expect(planSummaryLabel(summarizePlan({ subscription: { ...sub, plan: null }, purchases: [] }, { isLoading: false, isError: false }))).toBe("Paid plan");
  });
});
