import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeScheduleDates, nextOccurrenceAtOrAfter, zonedPartsToUtc } from "./contentSchedule.ts";

const JHB = "Africa/Johannesburg";

Deno.test("3-day cadence: 4 posts land exactly 3 local days apart", () => {
  const start = zonedPartsToUtc({ year: 2026, month: 9, day: 1, hour: 9, minute: 0, second: 0 }, JHB);
  const slots = computeScheduleDates({ startAt: start, timezone: JHB, intervalDays: 3, count: 4 });
  assertEquals(slots.map((slot) => slot.localDate), ["2026-09-01", "2026-09-04", "2026-09-07", "2026-09-10"]);
});

Deno.test("every slot keeps the same local time-of-day as the series start", () => {
  const start = zonedPartsToUtc({ year: 2026, month: 9, day: 1, hour: 9, minute: 30, second: 0 }, JHB);
  const slots = computeScheduleDates({ startAt: start, timezone: JHB, intervalDays: 3, count: 6 });
  for (const slot of slots) {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: JHB, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const parts = formatter.formatToParts(slot.scheduledAt);
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    assertEquals(`${hour}:${minute}`, "09:30");
  }
});

Deno.test("18 posts at 3-day cadence produce 18 strictly increasing, correctly spaced dates", () => {
  const start = zonedPartsToUtc({ year: 2026, month: 1, day: 1, hour: 9, minute: 0, second: 0 }, JHB);
  const slots = computeScheduleDates({ startAt: start, timezone: JHB, intervalDays: 3, count: 18 });
  assertEquals(slots.length, 18);
  assertEquals(slots[0].localDate, "2026-01-01");
  assertEquals(slots[1].localDate, "2026-01-04");
  assertEquals(slots[2].localDate, "2026-01-07");
  assertEquals(slots[17].localDate, "2026-02-21"); // day 1 + 17*3 = day 52 -> 2026-02-21
  for (let i = 1; i < slots.length; i++) {
    assertEquals(slots[i].scheduledAt.getTime() > slots[i - 1].scheduledAt.getTime(), true);
  }
});

Deno.test("ordering is preserved: slot index N always comes chronologically after slot index N-1", () => {
  const start = zonedPartsToUtc({ year: 2026, month: 6, day: 15, hour: 14, minute: 0, second: 0 }, JHB);
  const slots = computeScheduleDates({ startAt: start, timezone: JHB, intervalDays: 5, count: 10 });
  const times = slots.map((slot) => slot.scheduledAt.getTime());
  const sorted = [...times].sort((a, b) => a - b);
  assertEquals(times, sorted);
});

Deno.test("excluding a specific date shifts only that slot forward, without cascading into later spacing", () => {
  const start = zonedPartsToUtc({ year: 2026, month: 9, day: 1, hour: 9, minute: 0, second: 0 }, JHB);
  // Post index 1 would naturally land on 2026-09-04; exclude it.
  const slots = computeScheduleDates({
    startAt: start,
    timezone: JHB,
    intervalDays: 3,
    count: 4,
    excludedDates: ["2026-09-04"],
  });
  assertEquals(slots[0].localDate, "2026-09-01");
  assertEquals(slots[1].localDate, "2026-09-05"); // shifted forward by 1 day past the exclusion
  assertEquals(slots[1].shiftedForExclusion, true);
  // Slot 2's naive target (index*3 = day 7 -> 2026-09-07) is unaffected by slot 1's shift.
  assertEquals(slots[2].localDate, "2026-09-07");
  assertEquals(slots[2].shiftedForExclusion, false);
  assertEquals(slots[3].localDate, "2026-09-10");
});

Deno.test("excluding consecutive dates keeps advancing until a free date is found", () => {
  const start = zonedPartsToUtc({ year: 2026, month: 9, day: 1, hour: 9, minute: 0, second: 0 }, JHB);
  const slots = computeScheduleDates({
    startAt: start,
    timezone: JHB,
    intervalDays: 3,
    count: 2,
    excludedDates: ["2026-09-04", "2026-09-05", "2026-09-06"],
  });
  assertEquals(slots[1].localDate, "2026-09-07");
});

Deno.test("DST safety: a US Eastern-time series stays at the same local hour across the spring-forward transition", () => {
  // 2026-03-08 02:00 America/New_York is the DST transition (spring forward
  // to EDT). A naive "+3 days in UTC" implementation would land one hour off
  // local wall-clock time for any slot on/after the transition.
  const NY = "America/New_York";
  const start = zonedPartsToUtc({ year: 2026, month: 3, day: 6, hour: 9, minute: 0, second: 0 }, NY); // EST, before transition
  const slots = computeScheduleDates({ startAt: start, timezone: NY, intervalDays: 3, count: 2 }); // slot 1 lands 2026-03-09, after transition
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: NY, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const hourMinute = (d: Date) => {
    const parts = formatter.formatToParts(d);
    return `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  };
  assertEquals(hourMinute(slots[0].scheduledAt), "09:00");
  assertEquals(hourMinute(slots[1].scheduledAt), "09:00"); // still 09:00 local, even though the UTC offset changed
  assertEquals(slots[0].scheduledAt.getTime() !== slots[1].scheduledAt.getTime() - 3 * 24 * 60 * 60 * 1000, true); // proves it did NOT just add 3*86400s in UTC
});

Deno.test("nextOccurrenceAtOrAfter: reference time before today's posting time returns today at that time", () => {
  const timeOfDayFrom = zonedPartsToUtc({ year: 2000, month: 1, day: 1, hour: 9, minute: 30, second: 0 }, JHB);
  const reference = zonedPartsToUtc({ year: 2026, month: 9, day: 10, hour: 7, minute: 0, second: 0 }, JHB);
  const result = nextOccurrenceAtOrAfter(reference, timeOfDayFrom, JHB);
  assertEquals(result.getTime(), zonedPartsToUtc({ year: 2026, month: 9, day: 10, hour: 9, minute: 30, second: 0 }, JHB).getTime());
});

Deno.test("nextOccurrenceAtOrAfter: reference time after today's posting time rolls over to tomorrow", () => {
  const timeOfDayFrom = zonedPartsToUtc({ year: 2000, month: 1, day: 1, hour: 9, minute: 30, second: 0 }, JHB);
  const reference = zonedPartsToUtc({ year: 2026, month: 9, day: 10, hour: 15, minute: 0, second: 0 }, JHB);
  const result = nextOccurrenceAtOrAfter(reference, timeOfDayFrom, JHB);
  assertEquals(result.getTime(), zonedPartsToUtc({ year: 2026, month: 9, day: 11, hour: 9, minute: 30, second: 0 }, JHB).getTime());
});

Deno.test("nextOccurrenceAtOrAfter: reference time exactly at the posting time returns that same instant, not the next day", () => {
  const timeOfDayFrom = zonedPartsToUtc({ year: 2000, month: 1, day: 1, hour: 9, minute: 30, second: 0 }, JHB);
  const reference = zonedPartsToUtc({ year: 2026, month: 9, day: 10, hour: 9, minute: 30, second: 0 }, JHB);
  const result = nextOccurrenceAtOrAfter(reference, timeOfDayFrom, JHB);
  assertEquals(result.getTime(), reference.getTime());
});

Deno.test("nextOccurrenceAtOrAfter: stays at the correct local hour across a DST spring-forward transition", () => {
  const NY = "America/New_York";
  const timeOfDayFrom = zonedPartsToUtc({ year: 2000, month: 1, day: 1, hour: 9, minute: 0, second: 0 }, NY);
  // Reference is the morning of the spring-forward day itself, before 09:00 local.
  const reference = zonedPartsToUtc({ year: 2026, month: 3, day: 8, hour: 7, minute: 0, second: 0 }, NY);
  const result = nextOccurrenceAtOrAfter(reference, timeOfDayFrom, NY);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: NY, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = formatter.formatToParts(result);
  assertEquals(`${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`, "09:00");
});

Deno.test("count of 0 returns an empty schedule, count validation rejects invalid input", () => {
  const start = zonedPartsToUtc({ year: 2026, month: 9, day: 1, hour: 9, minute: 0, second: 0 }, JHB);
  assertEquals(computeScheduleDates({ startAt: start, timezone: JHB, intervalDays: 3, count: 0 }), []);
  let threw = false;
  try {
    computeScheduleDates({ startAt: start, timezone: JHB, intervalDays: 0, count: 5 });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
