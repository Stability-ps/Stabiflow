// Phase H. Timezone-aware date-range resolution for Analytics - the ONE
// place a date-picker selection (or preset) becomes the UTC instants every
// analytics RPC actually filters on. No new dependency: IANA timezone
// conversion via native Intl.DateTimeFormat, the standard vanilla-JS
// technique (format "now" in the target zone to read its wall-clock
// offset, then subtract that offset to get the UTC instant for a given
// local midnight) - date-fns v3 (already a dependency) has no built-in
// IANA support, and pulling in date-fns-tz for this alone isn't justified.
//
// Every function here takes `now` as an explicit parameter rather than
// reading the clock itself - required for deterministic unit tests, and
// consistent with this repo's existing "no hidden Date.now()" convention.

export type DateRangePreset = "last_7_days" | "last_30_days" | "last_90_days" | "this_month" | "last_month" | "custom";

export type DateRange = { from: Date; to: Date };

/** Minutes to ADD to a UTC instant to get that instant's wall-clock time in `timeZone` (i.e. localTime = utc + offset). */
function timezoneOffsetMinutes(utcInstant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(utcInstant).reduce((acc: Record<string, string>, p) => { acc[p.type] = p.value; return acc; }, {});
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asIfUtc - utcInstant.getTime()) / 60000;
}

/** The UTC instant corresponding to local midnight (00:00:00) on `localDateStr` ("YYYY-MM-DD") in `timeZone`. */
function localMidnightToUtc(localDateStr: string, timeZone: string): Date {
  const guessUtc = new Date(`${localDateStr}T00:00:00Z`);
  const offsetMinutes = timezoneOffsetMinutes(guessUtc, timeZone);
  return new Date(guessUtc.getTime() - offsetMinutes * 60000);
}

/** "YYYY-MM-DD" for `instant`'s wall-clock date in `timeZone`. */
export function localDateString(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Resolves a preset (or a custom {from, to} local-date pair) into UTC instants - half-open [from, to). `to` is exclusive: the instant is the START of the day AFTER the last included day, so a same-day range is never empty. */
export function resolveDateRangePreset(preset: DateRangePreset, timeZone: string, now: Date, custom?: { fromDateStr: string; toDateStr: string }): DateRange {
  const today = localDateString(now, timeZone);

  if (preset === "custom") {
    if (!custom) throw new Error("custom range requires fromDateStr/toDateStr");
    return { from: localMidnightToUtc(custom.fromDateStr, timeZone), to: localMidnightToUtc(addDays(custom.toDateStr, 1), timeZone) };
  }
  if (preset === "last_7_days") {
    return { from: localMidnightToUtc(addDays(today, -6), timeZone), to: localMidnightToUtc(addDays(today, 1), timeZone) };
  }
  if (preset === "last_30_days") {
    return { from: localMidnightToUtc(addDays(today, -29), timeZone), to: localMidnightToUtc(addDays(today, 1), timeZone) };
  }
  if (preset === "last_90_days") {
    return { from: localMidnightToUtc(addDays(today, -89), timeZone), to: localMidnightToUtc(addDays(today, 1), timeZone) };
  }
  if (preset === "this_month") {
    const [y, m] = today.split("-");
    const firstOfMonth = `${y}-${m}-01`;
    return { from: localMidnightToUtc(firstOfMonth, timeZone), to: localMidnightToUtc(addDays(today, 1), timeZone) };
  }
  // last_month
  const [y, m] = today.split("-").map(Number);
  const firstOfThisMonth = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastMonthEndExclusive = firstOfThisMonth; // the day AFTER last month's last day
  const firstOfLastMonth = addDays(firstOfThisMonth, -1).slice(0, 8) + "01"; // any day in prev month, forced to day 01
  return { from: localMidnightToUtc(firstOfLastMonth, timeZone), to: localMidnightToUtc(lastMonthEndExclusive, timeZone) };
}

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom range",
};

/** The immediately preceding period of equal length, for comparison ("last 30 days vs previous 30 days") - always contiguous and non-overlapping with `range`. */
export function previousComparisonRange(range: DateRange): DateRange {
  const durationMs = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - durationMs), to: new Date(range.from.getTime()) };
}
