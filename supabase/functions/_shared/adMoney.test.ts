import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { convertDecimalToMinorUnits, formatMinorUnitsAsDecimal, validateCampaignBudget } from "./adMoney.ts";

const future = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

Deno.test("convertDecimalToMinorUnits rounds instead of truncating", () => {
  assertEquals(convertDecimalToMinorUnits(10.995), 1100);
  assertEquals(convertDecimalToMinorUnits(10.994), 1099);
  assertEquals(convertDecimalToMinorUnits(100), 10000);
});

Deno.test("formatMinorUnitsAsDecimal round-trips convertDecimalToMinorUnits for clean values", () => {
  assertEquals(formatMinorUnitsAsDecimal(convertDecimalToMinorUnits(250)), "250.00");
  assertEquals(formatMinorUnitsAsDecimal(1050), "10.50");
});

Deno.test("a valid daily budget campaign passes", () => {
  const result = validateCampaignBudget({
    budgetType: "daily",
    dailyBudgetMinorUnits: 5000,
    lifetimeBudgetMinorUnits: null,
    currency: "ZAR",
    startAt: future(1),
    endAt: null,
  });
  assertEquals(result.valid, true);
});

Deno.test("a valid lifetime budget campaign requires an end date", () => {
  const withoutEnd = validateCampaignBudget({
    budgetType: "lifetime",
    dailyBudgetMinorUnits: null,
    lifetimeBudgetMinorUnits: 100000,
    currency: "ZAR",
    startAt: future(1),
    endAt: null,
  });
  assertEquals(withoutEnd.valid, false);
  if (!withoutEnd.valid) assertEquals(withoutEnd.issues.some((i) => i.includes("end date")), true);

  const withEnd = validateCampaignBudget({
    budgetType: "lifetime",
    dailyBudgetMinorUnits: null,
    lifetimeBudgetMinorUnits: 100000,
    currency: "ZAR",
    startAt: future(1),
    endAt: future(10),
  });
  assertEquals(withEnd.valid, true);
});

Deno.test("REGRESSION: a lifetime budget campaign must not also set a daily budget (and vice versa)", () => {
  const result = validateCampaignBudget({
    budgetType: "lifetime",
    dailyBudgetMinorUnits: 5000,
    lifetimeBudgetMinorUnits: 100000,
    currency: "ZAR",
    startAt: future(1),
    endAt: future(10),
  });
  assertEquals(result.valid, false);
});

Deno.test("budget below the minimum floor is rejected", () => {
  const result = validateCampaignBudget({
    budgetType: "daily",
    dailyBudgetMinorUnits: 1,
    lifetimeBudgetMinorUnits: null,
    currency: "ZAR",
    startAt: future(1),
    endAt: null,
  });
  assertEquals(result.valid, false);
});

Deno.test("budget above the sanity ceiling is rejected", () => {
  const result = validateCampaignBudget({
    budgetType: "daily",
    dailyBudgetMinorUnits: 100_000_000_00 + 1,
    lifetimeBudgetMinorUnits: null,
    currency: "ZAR",
    startAt: future(1),
    endAt: null,
  });
  assertEquals(result.valid, false);
});

Deno.test("a non-integer minor-units value is rejected (guards against a raw decimal amount leaking through)", () => {
  const result = validateCampaignBudget({
    budgetType: "daily",
    dailyBudgetMinorUnits: 50.5,
    lifetimeBudgetMinorUnits: null,
    currency: "ZAR",
    startAt: future(1),
    endAt: null,
  });
  assertEquals(result.valid, false);
});

Deno.test("currency must be a 3-letter ISO 4217 code", () => {
  const result = validateCampaignBudget({
    budgetType: "daily",
    dailyBudgetMinorUnits: 5000,
    lifetimeBudgetMinorUnits: null,
    currency: "rand",
    startAt: future(1),
    endAt: null,
  });
  assertEquals(result.valid, false);
});

Deno.test("end date must be strictly after start date", () => {
  const start = future(5);
  const result = validateCampaignBudget({
    budgetType: "lifetime",
    dailyBudgetMinorUnits: null,
    lifetimeBudgetMinorUnits: 100000,
    currency: "ZAR",
    startAt: start,
    endAt: start,
  });
  assertEquals(result.valid, false);
});

Deno.test("start date must not be in the past", () => {
  const result = validateCampaignBudget({
    budgetType: "daily",
    dailyBudgetMinorUnits: 5000,
    lifetimeBudgetMinorUnits: null,
    currency: "ZAR",
    startAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    endAt: null,
  });
  assertEquals(result.valid, false);
});
