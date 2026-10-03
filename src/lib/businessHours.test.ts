import { describe, expect, it } from "vitest";
import {
  defaultSchedule,
  isOpenAt,
  toSchedule,
  validateOutsideHoursReply,
  validateSchedule,
  type BusinessHoursDay,
} from "./businessHours";

const MON_FRI_9_5: BusinessHoursDay[] = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
  day_of_week: d,
  is_open: d <= 5,
  opens_at: d <= 5 ? "09:00" : null,
  closes_at: d <= 5 ? "17:00" : null,
}));

describe("validateSchedule", () => {
  it("accepts a well-formed Mon-Fri schedule and the default", () => {
    expect(validateSchedule(MON_FRI_9_5)).toEqual([]);
    expect(validateSchedule(defaultSchedule())).toEqual([]);
  });
  it("rejects an open day missing a time", () => {
    const bad = MON_FRI_9_5.map((d) => (d.day_of_week === 3 ? { ...d, closes_at: null } : d));
    expect(validateSchedule(bad).map((e) => e.day_of_week)).toEqual([3]);
  });
  it("rejects close <= open (no overnight support)", () => {
    const overnight = MON_FRI_9_5.map((d) => (d.day_of_week === 2 ? { ...d, opens_at: "22:00", closes_at: "06:00" } : d));
    expect(validateSchedule(overnight)[0].message).toMatch(/closing time must be after opening time/);
    const equal = MON_FRI_9_5.map((d) => (d.day_of_week === 2 ? { ...d, opens_at: "09:00", closes_at: "09:00" } : d));
    expect(validateSchedule(equal)).toHaveLength(1);
  });
  it("ignores times on closed days", () => {
    const closedWithJunk: BusinessHoursDay[] = MON_FRI_9_5.map((d) =>
      d.day_of_week === 7 ? { ...d, is_open: false, opens_at: "99:99", closes_at: null } : d,
    );
    expect(validateSchedule(closedWithJunk)).toEqual([]);
  });
});

describe("validateOutsideHoursReply", () => {
  it("requires a non-blank message only when enabled", () => {
    expect(validateOutsideHoursReply(false, "")).toBeNull();
    expect(validateOutsideHoursReply(false, null)).toBeNull();
    expect(validateOutsideHoursReply(true, "   ")).toMatch(/Enter the message/);
    expect(validateOutsideHoursReply(true, "We're closed")).toBeNull();
  });
});

describe("toSchedule", () => {
  it("fills gaps to a full seven-day ordered schedule and trims HH:MM:SS", () => {
    const s = toSchedule([{ day_of_week: 1, is_open: true, opens_at: "08:30:00", closes_at: "16:45:00" }]);
    expect(s).toHaveLength(7);
    expect(s.map((d) => d.day_of_week)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s[0]).toMatchObject({ day_of_week: 1, is_open: true, opens_at: "08:30", closes_at: "16:45" });
  });
});

describe("isOpenAt (display-only mirror of workspace_is_open_at)", () => {
  it("open during hours, closed before/after and on weekends", () => {
    const tz = "Africa/Johannesburg"; // UTC+2, no DST
    // 2026-06-15 is a Monday. 10:00 SAST = 08:00Z
    expect(isOpenAt(MON_FRI_9_5, tz, new Date("2026-06-15T08:00:00Z"))).toBe(true);
    // 06:00 SAST = 04:00Z -> before opening
    expect(isOpenAt(MON_FRI_9_5, tz, new Date("2026-06-15T04:00:00Z"))).toBe(false);
    // 17:00 SAST = 15:00Z -> exactly closing (exclusive) -> closed
    expect(isOpenAt(MON_FRI_9_5, tz, new Date("2026-06-15T15:00:00Z"))).toBe(false);
    // Saturday
    expect(isOpenAt(MON_FRI_9_5, tz, new Date("2026-06-20T10:00:00Z"))).toBe(false);
  });

  it("respects a DST-observing timezone (America/New_York)", () => {
    const tz = "America/New_York";
    // 2026-07-06 Monday, summer -> EDT (UTC-4). 09:30 EDT = 13:30Z -> open
    expect(isOpenAt(MON_FRI_9_5, tz, new Date("2026-07-06T13:30:00Z"))).toBe(true);
    // 2026-01-05 Monday, winter -> EST (UTC-5). 13:30Z = 08:30 EST -> before 09:00 open
    expect(isOpenAt(MON_FRI_9_5, tz, new Date("2026-01-05T13:30:00Z"))).toBe(false);
    // 2026-01-05 14:30Z = 09:30 EST -> open
    expect(isOpenAt(MON_FRI_9_5, tz, new Date("2026-01-05T14:30:00Z"))).toBe(true);
  });

  it("browser timezone is irrelevant - only the passed IANA zone matters", () => {
    const tzA = "Africa/Johannesburg";
    const tzB = "Pacific/Honolulu"; // UTC-10
    const instant = new Date("2026-06-15T08:00:00Z"); // Mon 10:00 SAST / Sun 22:00 HST
    expect(isOpenAt(MON_FRI_9_5, tzA, instant)).toBe(true);
    expect(isOpenAt(MON_FRI_9_5, tzB, instant)).toBe(false); // still Sunday in Honolulu
  });

  it("all-closed schedule is never open", () => {
    const closed = MON_FRI_9_5.map((d) => ({ ...d, is_open: false, opens_at: null, closes_at: null }));
    expect(isOpenAt(closed, "Africa/Johannesburg", new Date("2026-06-15T10:00:00Z"))).toBe(false);
  });
});
