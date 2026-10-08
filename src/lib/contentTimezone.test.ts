import { describe, expect, it } from "vitest";
import { calendarDateKey, dateKeyInZone, startOfCalendarDayInZone, todayInZone } from "./contentTimezone";

describe("content calendar timezone helpers", () => {
  it("dateKeyInZone puts one instant on the workspace's day, whatever the viewer's zone", () => {
    const instant = "2026-01-15T12:00:00.000Z";
    expect(dateKeyInZone(instant, "Pacific/Kiritimati")).toBe("2026-01-16"); // UTC+14
    expect(dateKeyInZone(instant, "Pacific/Pago_Pago")).toBe("2026-01-15"); // UTC-11
    expect(dateKeyInZone("2026-03-31T22:30:00.000Z", "Africa/Johannesburg")).toBe("2026-04-01");
  });

  it("startOfCalendarDayInZone is midnight in the workspace, DST-safe", () => {
    expect(startOfCalendarDayInZone(new Date(2026, 0, 15), "Africa/Johannesburg").toISOString()).toBe("2026-01-14T22:00:00.000Z");
    // New York switches to EDT on 2026-03-08: midnight that day is still EST (-5).
    expect(startOfCalendarDayInZone(new Date(2026, 2, 8), "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(startOfCalendarDayInZone(new Date(2026, 2, 9), "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("todayInZone/calendarDateKey give the workspace's date as a plain calendar date", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    expect(calendarDateKey(todayInZone("Pacific/Kiritimati", now))).toBe("2026-01-16");
    expect(calendarDateKey(todayInZone("Pacific/Pago_Pago", now))).toBe("2026-01-15");
  });
});
