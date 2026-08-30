import { describe, it, expect } from "vitest";
import {
  formatScheduleStart,
  formatScheduleSummary,
  isScheduledStartInPast,
  localDateTimeToUtc,
  safeTimeZone,
  utcToLocalDateTimeParts,
  WORKSPACE_TIMEZONE_FALLBACK,
} from "./campaignSchedule";

const JHB = "Africa/Johannesburg"; // UTC+2, no DST
const NY = "America/New_York"; // DST-capable

describe("safeTimeZone", () => {
  it("passes a valid IANA zone through", () => {
    expect(safeTimeZone(JHB)).toBe(JHB);
    expect(safeTimeZone(NY)).toBe(NY);
  });
  it("falls back for null/empty/garbage without throwing", () => {
    expect(safeTimeZone(null)).toBe(WORKSPACE_TIMEZONE_FALLBACK);
    expect(safeTimeZone("")).toBe(WORKSPACE_TIMEZONE_FALLBACK);
    expect(safeTimeZone("Not/AZone")).toBe(WORKSPACE_TIMEZONE_FALLBACK);
  });
});

describe("localDateTimeToUtc - workspace-local date + time -> UTC instant", () => {
  it("converts an Africa/Johannesburg wall-clock time to the correct UTC instant (UTC+2)", () => {
    expect(localDateTimeToUtc("2026-08-30", "14:30", JHB)!.toISOString()).toBe("2026-08-30T12:30:00.000Z");
  });

  it("round-trips: instant -> local parts -> instant", () => {
    const iso = "2026-08-30T12:30:00.000Z";
    const parts = utcToLocalDateTimeParts(iso, JHB);
    expect(parts).toEqual({ date: "2026-08-30", time: "14:30" });
    expect(localDateTimeToUtc(parts.date, parts.time, JHB)!.toISOString()).toBe(iso);
  });

  it("day boundary: 00:00 local is the previous UTC day for a positive offset zone", () => {
    expect(localDateTimeToUtc("2026-08-30", "00:00", JHB)!.toISOString()).toBe("2026-08-29T22:00:00.000Z");
    // ...and the reverse hydration lands back on 2026-08-30 00:00 local, not 2026-08-29.
    expect(utcToLocalDateTimeParts("2026-08-29T22:00:00.000Z", JHB)).toEqual({ date: "2026-08-30", time: "00:00" });
  });

  it("DST: America/New_York is UTC-4 in summer and UTC-5 in winter for the SAME wall-clock time", () => {
    expect(localDateTimeToUtc("2026-07-01", "12:00", NY)!.toISOString()).toBe("2026-07-01T16:00:00.000Z"); // EDT
    expect(localDateTimeToUtc("2026-01-01", "12:00", NY)!.toISOString()).toBe("2026-01-01T17:00:00.000Z"); // EST
  });

  it("returns null for malformed date or time", () => {
    expect(localDateTimeToUtc("2026/08/30", "14:30", JHB)).toBeNull();
    expect(localDateTimeToUtc("2026-08-30", "2pm", JHB)).toBeNull();
    expect(localDateTimeToUtc("", "", JHB)).toBeNull();
  });

  it("a malformed timezone degrades to the fallback zone rather than throwing", () => {
    expect(localDateTimeToUtc("2026-08-30", "14:30", "Nope/Nope")!.toISOString()).toBe("2026-08-30T12:30:00.000Z");
  });
});

describe("isScheduledStartInPast", () => {
  const NOW = new Date("2026-08-30T12:00:00Z");
  it("null (Start now) is never in the past", () => {
    expect(isScheduledStartInPast(null, NOW)).toBe(false);
  });
  it("an instant strictly before now is past; exactly now counts as past; after now is not", () => {
    expect(isScheduledStartInPast("2026-08-30T11:59:00Z", NOW)).toBe(true);
    expect(isScheduledStartInPast("2026-08-30T12:00:00Z", NOW)).toBe(true);
    expect(isScheduledStartInPast("2026-08-30T12:01:00Z", NOW)).toBe(false);
  });
  it("later today (same calendar day, future instant) is NOT past", () => {
    expect(isScheduledStartInPast("2026-08-30T18:00:00Z", NOW)).toBe(false);
  });
  it("a malformed instant is treated as not-past", () => {
    expect(isScheduledStartInPast("not-a-date", NOW)).toBe(false);
  });
});

describe("formatScheduleSummary (list) / formatScheduleStart (detail)", () => {
  const NOW = new Date("2026-08-30T12:00:00Z"); // 14:00 JHB

  it("null start -> 'Starts now' / 'Start now'", () => {
    expect(formatScheduleSummary(null, JHB, NOW)).toBe("Starts now");
    expect(formatScheduleStart(null, JHB)).toBe("Start now");
  });

  it("a start later the same workspace day -> 'Today, HH:mm'", () => {
    expect(formatScheduleSummary("2026-08-30T16:00:00Z", JHB, NOW)).toBe("Today, 18:00");
  });

  it("a start on another day -> 'DD/MM/YYYY, HH:mm'", () => {
    expect(formatScheduleSummary("2026-09-01T07:00:00Z", JHB, NOW)).toBe("01/09/2026, 09:00");
  });

  it("detail label includes date and time in the workspace zone", () => {
    expect(formatScheduleStart("2026-09-01T07:00:00Z", JHB)).toBe("01/09/2026, 09:00");
  });

  it("does not crash on a null-zone or bad instant", () => {
    expect(formatScheduleSummary("bad", JHB, NOW)).toBe("-");
    expect(formatScheduleStart("2026-09-01T07:00:00Z", "Nope/Nope")).toBe("01/09/2026, 09:00");
  });
});
