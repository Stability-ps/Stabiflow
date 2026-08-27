import { describe, expect, it } from "vitest";
import { localDateString, previousComparisonRange, resolveDateRangePreset } from "./analyticsDate";

// Fixed reference instant throughout - never Date.now() - for deterministic tests.
// 2026-08-27T10:00:00Z is 2026-08-27 12:00 in Africa/Johannesburg (UTC+2)
// and 2026-08-27 06:00 in America/New_York (UTC-4, daylight time in August).
const NOW = new Date("2026-08-27T10:00:00Z");

describe("localDateString", () => {
  it("renders the correct local calendar date for a timezone ahead of UTC", () => {
    expect(localDateString(NOW, "Africa/Johannesburg")).toBe("2026-08-27");
  });
  it("renders the correct local calendar date for a timezone behind UTC", () => {
    expect(localDateString(NOW, "America/New_York")).toBe("2026-08-27");
  });
  it("REGRESSION: a late-UTC instant can be the NEXT calendar day in an ahead-of-UTC timezone", () => {
    const lateUtc = new Date("2026-08-27T23:30:00Z");
    expect(localDateString(lateUtc, "Africa/Johannesburg")).toBe("2026-08-28");
    expect(localDateString(lateUtc, "UTC")).toBe("2026-08-27");
  });
});

describe("resolveDateRangePreset", () => {
  it("last_7_days spans exactly 7 local calendar days, ending the instant after today", () => {
    const range = resolveDateRangePreset("last_7_days", "Africa/Johannesburg", NOW);
    expect(localDateString(range.from, "Africa/Johannesburg")).toBe("2026-08-21");
    expect(localDateString(new Date(range.to.getTime() - 1), "Africa/Johannesburg")).toBe("2026-08-27");
  });

  it("last_30_days and last_90_days span the expected number of days", () => {
    const r30 = resolveDateRangePreset("last_30_days", "Africa/Johannesburg", NOW);
    const days30 = Math.round((r30.to.getTime() - r30.from.getTime()) / 86400000);
    expect(days30).toBe(30);

    const r90 = resolveDateRangePreset("last_90_days", "Africa/Johannesburg", NOW);
    const days90 = Math.round((r90.to.getTime() - r90.from.getTime()) / 86400000);
    expect(days90).toBe(90);
  });

  it("this_month starts on the 1st of the current local month", () => {
    const range = resolveDateRangePreset("this_month", "Africa/Johannesburg", NOW);
    expect(localDateString(range.from, "Africa/Johannesburg")).toBe("2026-08-01");
  });

  it("last_month is the entire previous calendar month, never touching this month", () => {
    const range = resolveDateRangePreset("last_month", "Africa/Johannesburg", NOW);
    expect(localDateString(range.from, "Africa/Johannesburg")).toBe("2026-07-01");
    expect(localDateString(new Date(range.to.getTime() - 1), "Africa/Johannesburg")).toBe("2026-07-31");
  });

  it("custom range respects the exact from/to local dates given, inclusive of the end date", () => {
    const range = resolveDateRangePreset("custom", "Africa/Johannesburg", NOW, { fromDateStr: "2026-01-01", toDateStr: "2026-01-10" });
    expect(localDateString(range.from, "Africa/Johannesburg")).toBe("2026-01-01");
    expect(localDateString(new Date(range.to.getTime() - 1), "Africa/Johannesburg")).toBe("2026-01-10");
  });

  it("REGRESSION: timezone actually shifts the resolved UTC boundary - Johannesburg and New York produce different instants for the same preset", () => {
    const joburg = resolveDateRangePreset("this_month", "Africa/Johannesburg", NOW);
    const newYork = resolveDateRangePreset("this_month", "America/New_York", NOW);
    expect(joburg.from.getTime()).not.toBe(newYork.from.getTime());
  });
});

describe("previousComparisonRange", () => {
  it("returns a contiguous, non-overlapping, equal-length prior period", () => {
    const current = resolveDateRangePreset("last_30_days", "Africa/Johannesburg", NOW);
    const previous = previousComparisonRange(current);
    expect(previous.to.getTime()).toBe(current.from.getTime()); // contiguous, no gap or overlap
    expect(previous.to.getTime() - previous.from.getTime()).toBe(current.to.getTime() - current.from.getTime()); // equal length
  });
});
