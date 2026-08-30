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

// --- Scheduling model: timezone-aware DATE + TIME resolved to a UTC
// instant, or null for "Start now". validateCampaignBudget compares
// instants; there is NO artificial minimum buffer - any genuinely future
// instant is accepted, and "Start now" (null) is always valid.

const sched = (over: Partial<Parameters<typeof validateCampaignBudget>[0]>) =>
  validateCampaignBudget({
    budgetType: "daily",
    dailyBudgetMinorUnits: 5000,
    lifetimeBudgetMinorUnits: null,
    currency: "ZAR",
    startAt: null,
    endAt: null,
    now: new Date("2026-08-30T12:00:00Z"),
    ...over,
  });

Deno.test("START NOW: startAt null is always valid (immediate publish)", () => {
  assertEquals(sched({ startAt: null }).valid, true);
});

Deno.test("START NOW with an end time that is in the future is valid; a past end time is not", () => {
  assertEquals(sched({ startAt: null, endAt: new Date("2026-08-31T12:00:00Z") }).valid, true);
  const past = sched({ startAt: null, endAt: new Date("2026-08-30T11:00:00Z") });
  assertEquals(past.valid, false);
  if (!past.valid) assertEquals(past.issues.some((i) => i.includes("end time must be after the start time")), true);
});

Deno.test("SCHEDULED: a start instant one minute in the future is valid - no minimum buffer", () => {
  assertEquals(sched({ startAt: new Date("2026-08-30T12:01:00Z") }).valid, true);
});

Deno.test("SCHEDULED: a start instant ten minutes in the future is valid", () => {
  assertEquals(sched({ startAt: new Date("2026-08-30T12:10:00Z") }).valid, true);
});

Deno.test("SCHEDULED: a start instant equal to now is 'has passed' (not in the future)", () => {
  const r = sched({ startAt: new Date("2026-08-30T12:00:00Z") });
  assertEquals(r.valid, false);
  if (!r.valid) assertEquals(r.issues.some((i) => i.includes("scheduled start time has passed")), true);
});

Deno.test("SCHEDULED: a start instant one minute in the past has passed", () => {
  const r = sched({ startAt: new Date("2026-08-30T11:59:00Z") });
  assertEquals(r.valid, false);
  if (!r.valid) assertEquals(r.issues.some((i) => i.includes("scheduled start time has passed")), true);
});

Deno.test("REGRESSION: 'later today' is valid - a same-day afternoon start no longer fails just because the calendar date == today", () => {
  // now 14:00 SAST == 12:00Z. Start 18:00 SAST == 16:00Z, same calendar day, future instant.
  assertEquals(sched({ now: new Date("2026-08-30T12:00:00Z"), startAt: new Date("2026-08-30T16:00:00Z") }).valid, true);
});

Deno.test("REGRESSION (publish-time recheck): a start scheduled for 14:10 becomes invalid once 'now' passes it", () => {
  const start = new Date("2026-08-30T14:10:00Z");
  assertEquals(sched({ startAt: start, now: new Date("2026-08-30T14:00:00Z") }).valid, true);  // scheduled at 14:00
  assertEquals(sched({ startAt: start, now: new Date("2026-08-30T14:20:00Z") }).valid, false); // Publish clicked at 14:20
});

Deno.test("SCHEDULED: end must be strictly after the scheduled start instant", () => {
  const start = new Date("2026-09-01T09:00:00Z");
  assertEquals(sched({ startAt: start, endAt: start }).valid, false);
  assertEquals(sched({ startAt: start, endAt: new Date("2026-09-01T09:00:01Z") }).valid, true);
});
