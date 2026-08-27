import { describe, expect, it } from "vitest";
import {
  buildFunnel, computeRoas, costPerOutcome, formatCurrencyTotal, formatMoneyByCurrency, formatRoas,
  overallFunnelRate, periodOverPeriodChange, safeRate, summarizeCurrency, withSourcePercentages,
} from "./analytics";

describe("safeRate", () => {
  it("computes a normal conversion rate", () => {
    expect(safeRate(100, 25)).toBe(25);
  });
  it("REGRESSION: never divides by zero - returns null when the denominator (from) is 0", () => {
    expect(safeRate(0, 5)).toBeNull();
  });
  it("returns null for a negative/invalid from", () => {
    expect(safeRate(-1, 5)).toBeNull();
  });
});

describe("costPerOutcome", () => {
  it("computes cost per outcome normally", () => {
    expect(costPerOutcome(10000, 5)).toBe(2000);
  });
  it("REGRESSION: never divides by zero - returns null when count is 0, even if spend is positive", () => {
    expect(costPerOutcome(10000, 0)).toBeNull();
  });
  it("a real zero spend with a positive count is a legitimate zero cost, not null", () => {
    expect(costPerOutcome(0, 5)).toBe(0);
  });
});

describe("summarizeCurrency / formatCurrencyTotal", () => {
  it("an empty array means no data at all", () => {
    expect(summarizeCurrency([])).toEqual({ kind: "empty" });
  });
  it("a single currency collapses cleanly", () => {
    expect(summarizeCurrency([{ currency: "USD", amount_minor: 5000 }])).toEqual({ kind: "single", currency: "USD", amountMinor: 5000 });
  });
  it("REGRESSION: two different currencies are never silently summed - reported as mixed", () => {
    const result = summarizeCurrency([{ currency: "USD", amount_minor: 100 }, { currency: "ZAR", amount_minor: 200 }]);
    expect(result.kind).toBe("mixed");
  });
  it("formats a mixed-currency total as an explicit mixed state, not a number", () => {
    const text = formatCurrencyTotal({ kind: "mixed", currencies: ["USD", "ZAR"] });
    expect(text).toMatch(/mixed/i);
    expect(text).toMatch(/USD/);
    expect(text).toMatch(/ZAR/);
  });
  it("formatMoneyByCurrency renders a single-currency total using real currency formatting (locale-independent check - Intl.NumberFormat's exact glyphs vary by runtime locale)", () => {
    const text = formatMoneyByCurrency([{ currency: "USD", amount_minor: 150000 }]);
    expect(text).toMatch(/1[.,\s]?500/); // the amount, in whatever grouping/decimal glyphs this runtime's default locale uses
    expect(text).toMatch(/\$|USD/);
  });
});

describe("computeRoas", () => {
  it("computes ROAS when spend and same-currency revenue both exist", () => {
    const result = computeRoas(10000, "USD", [{ currency: "USD", amount_minor: 50000 }]);
    expect(result).toEqual({ status: "ok", value: 5, currency: "USD" });
  });
  it("REGRESSION: never shows ROAS with zero spend", () => {
    expect(computeRoas(0, "USD", [{ currency: "USD", amount_minor: 50000 }])).toEqual({ status: "unavailable", reason: "no_spend" });
  });
  it("REGRESSION: never shows ROAS with no attributed revenue", () => {
    expect(computeRoas(10000, "USD", [])).toEqual({ status: "unavailable", reason: "no_revenue" });
  });
  it("REGRESSION: never silently converts currency - mismatched currency is reported as mixed, not computed", () => {
    const result = computeRoas(10000, "USD", [{ currency: "ZAR", amount_minor: 50000 }]);
    expect(result.status).toBe("mixed_currency");
  });
  it("REGRESSION: revenue split across multiple currencies is mixed, even if one matches spend currency", () => {
    const result = computeRoas(10000, "USD", [{ currency: "USD", amount_minor: 20000 }, { currency: "ZAR", amount_minor: 10000 }]);
    expect(result.status).toBe("mixed_currency");
  });
  it("formatRoas renders an honest label for each non-ok state", () => {
    expect(formatRoas({ status: "unavailable", reason: "no_spend" })).toMatch(/no spend/i);
    expect(formatRoas({ status: "unavailable", reason: "no_revenue" })).toMatch(/no attributed revenue/i);
    expect(formatRoas({ status: "mixed_currency" })).toMatch(/mixed/i);
    expect(formatRoas({ status: "ok", value: 3.456, currency: "USD" })).toBe("3.46x");
  });
});

describe("buildFunnel / overallFunnelRate", () => {
  const stages = [
    { label: "Conversations", count: 100 },
    { label: "Leads", count: 40 },
    { label: "Qualified", count: 20 },
    { label: "Opportunities", count: 10 },
    { label: "Customers", count: 4 },
  ];

  it("computes stage-to-stage conversion rates, with the first stage having no rate", () => {
    const result = buildFunnel(stages);
    expect(result[0].rateFromPrevious).toBeNull();
    expect(result[1].rateFromPrevious).toBe(40);
    expect(result[4].rateFromPrevious).toBe(40); // 4/10 opportunities-to-customers
  });
  it("REGRESSION: a zero-count stage never produces a fabricated rate for the NEXT stage", () => {
    const withZero = [{ label: "A", count: 0 }, { label: "B", count: 5 }];
    const result = buildFunnel(withZero);
    expect(result[1].rateFromPrevious).toBeNull();
  });
  it("overallFunnelRate computes conversation-to-customer conversion end to end", () => {
    expect(overallFunnelRate(stages)).toBe(4);
  });
  it("overallFunnelRate is null when the first stage is 0", () => {
    expect(overallFunnelRate([{ label: "A", count: 0 }, { label: "B", count: 0 }])).toBeNull();
  });
});

describe("withSourcePercentages", () => {
  it("computes percentages that sum to 100", () => {
    const result = withSourcePercentages([{ label: "Meta Paid", count: 30 }, { label: "Direct WhatsApp", count: 70 }]);
    expect(result[0].percentage).toBe(30);
    expect(result[1].percentage).toBe(70);
  });
  it("REGRESSION: an empty source list never divides by zero - percentages are null, not NaN", () => {
    const result = withSourcePercentages([{ label: "Unknown", count: 0 }]);
    expect(result[0].percentage).toBeNull();
  });
});

describe("periodOverPeriodChange", () => {
  it("computes a normal percentage change", () => {
    expect(periodOverPeriodChange(100, 150)).toBe(50);
  });
  it("REGRESSION: never manufactures a trend when the previous period is 0", () => {
    expect(periodOverPeriodChange(0, 50)).toBeNull();
  });
  it("REGRESSION: never manufactures a trend when either period is missing", () => {
    expect(periodOverPeriodChange(null, 50)).toBeNull();
    expect(periodOverPeriodChange(100, undefined)).toBeNull();
  });
});
