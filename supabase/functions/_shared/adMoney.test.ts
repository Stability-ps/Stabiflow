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

// --- Start-date is a CALENDAR-DATE comparison in the campaign's timezone,
// not an instant-vs-now comparison. Regression: a campaign whose start
// date is *today* used to fail readiness the moment local midnight passed,
// because its stored start_at instant (local midnight) was already hours
// before `now`. A start date of today must stay valid all day.

const daily = (over: Partial<Parameters<typeof validateCampaignBudget>[0]>) =>
  validateCampaignBudget({
    budgetType: "daily",
    dailyBudgetMinorUnits: 5000,
    lifetimeBudgetMinorUnits: null,
    currency: "ZAR",
    startAt: new Date("2026-08-29T00:00:00Z"),
    endAt: null,
    ...over,
  });

Deno.test("REGRESSION: a start date of TODAY is allowed even though its instant is earlier today than now (UTC)", () => {
  // start_at = 2026-08-29 00:00Z; now = 2026-08-29 14:00Z. Same UTC
  // calendar day -> allowed, despite the instant being 14h in the past.
  const result = daily({ timezone: "UTC", now: new Date("2026-08-29T14:00:00Z") });
  assertEquals(result.valid, true);
});

Deno.test("REGRESSION: start date of today in Africa/Johannesburg is allowed when its stored instant is local-midnight (already 'past' as an instant)", () => {
  // A campaign authored as "start 2026-08-29" in JHB is stored as
  // 2026-08-28T22:00:00Z (JHB is UTC+2). At now = 2026-08-29T10:00:00Z it
  // is still the 29th in Johannesburg -> must be allowed.
  const result = daily({
    startAt: new Date("2026-08-28T22:00:00Z"),
    timezone: "Africa/Johannesburg",
    now: new Date("2026-08-29T10:00:00Z"),
  });
  assertEquals(result.valid, true);
});

Deno.test("a start date that is genuinely yesterday in Africa/Johannesburg is still rejected", () => {
  const result = daily({
    startAt: new Date("2026-08-27T22:00:00Z"), // 2026-08-28 00:00 JHB
    timezone: "Africa/Johannesburg",
    now: new Date("2026-08-29T10:00:00Z"), // 2026-08-29 12:00 JHB
  });
  assertEquals(result.valid, false);
  if (!result.valid) assertEquals(result.issues.some((i) => i.includes("start date must not be in the past")), true);
});

Deno.test("timezone boundary: the last minute of the day in Johannesburg still counts as that day; the first minute of the next day does not", () => {
  const startAt = new Date("2026-08-28T22:00:00Z"); // 2026-08-29 00:00 JHB

  const lastMinute = daily({ startAt, timezone: "Africa/Johannesburg", now: new Date("2026-08-29T21:59:00Z") }); // 23:59 JHB, still the 29th
  assertEquals(lastMinute.valid, true);

  const nextMinute = daily({ startAt, timezone: "Africa/Johannesburg", now: new Date("2026-08-29T22:00:00Z") }); // 00:00 JHB on the 30th
  assertEquals(nextMinute.valid, false);
});

Deno.test("an unrecognised timezone string falls back to UTC rather than throwing", () => {
  const result = daily({ timezone: "Not/AZone", now: new Date("2026-08-29T14:00:00Z") });
  assertEquals(result.valid, true); // 2026-08-29 == 2026-08-29 under the UTC fallback
});
