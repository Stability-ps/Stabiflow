// Durable, DST-safe schedule generation for the Content module's optional
// series (recurring-cadence) posting flow. "Post N lands `intervalDays *
// (N-1)` local calendar days after the series' start, at the same local
// wall-clock time" - computed per IANA timezone via Intl, never a
// hardcoded UTC offset, so it stays correct for zones that do observe DST
// even though workspace_settings.timezone often won't.
//
// Ported unchanged from Acapolite's proven
// supabase/functions/_shared/socialSchedule.ts (see socialSchedule.test.ts
// in that repo for the original DST-safety proof) - this module has zero
// database/tenant coupling, so nothing needed to change to make it
// workspace-safe; the workspace boundary is enforced by what calls it.

export type ZonedDateParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsFromInstant(instant: Date, timeZone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// Standard "guess, measure the error against the target zone, correct"
// algorithm for turning local wall-clock components into the UTC instant
// that produces them in an arbitrary IANA timezone. DST-safe: the
// correction is recomputed independently for every date, so a transition
// between the guess and the target changes nothing about correctness.
export function zonedPartsToUtc(parts: ZonedDateParts, timeZone: string): Date {
  const guessUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const guess = new Date(guessUtcMs);
  const interpretedAsZoneParts = partsFromInstant(guess, timeZone);
  const interpretedAsZoneMs = Date.UTC(
    interpretedAsZoneParts.year,
    interpretedAsZoneParts.month - 1,
    interpretedAsZoneParts.day,
    interpretedAsZoneParts.hour,
    interpretedAsZoneParts.minute,
    interpretedAsZoneParts.second,
  );
  const driftMs = interpretedAsZoneMs - guessUtcMs;
  return new Date(guessUtcMs - driftMs);
}

function addCalendarDays(parts: ZonedDateParts, days: number): ZonedDateParts {
  // Deliberately do the day-count arithmetic in a timezone-naive UTC scratch
  // instant. Only the calendar date changes here; the local hour/minute/
  // second is carried through unchanged and re-anchored to the real zone by
  // zonedPartsToUtc afterwards, so this step can never encode a DST bug.
  const scratch = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  scratch.setUTCDate(scratch.getUTCDate() + days);
  return {
    year: scratch.getUTCFullYear(),
    month: scratch.getUTCMonth() + 1,
    day: scratch.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function dateKey(parts: ZonedDateParts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export type ScheduleInput = {
  startAt: Date;
  timezone: string;
  intervalDays: number;
  count: number;
  excludedDates?: string[]; // "YYYY-MM-DD", in the series' local timezone
};

export type ScheduledSlot = {
  index: number; // 0-based post index
  scheduledAt: Date;
  localDate: string; // "YYYY-MM-DD" for display/debugging
  shiftedForExclusion: boolean;
};

// Computes N posting instants, `intervalDays` local calendar days apart,
// starting from startAt's local wall-clock date/time. If a slot's naive
// target date is excluded, it advances day-by-day (still at the same local
// time) until it lands on a non-excluded date. Each slot's naive target is
// independent (index * intervalDays from the series start), so a shift
// caused by one exclusion never cascades into the spacing of later posts.
export function computeScheduleDates(input: ScheduleInput): ScheduledSlot[] {
  if (!Number.isFinite(input.intervalDays) || input.intervalDays <= 0) {
    throw new Error("intervalDays must be a positive number");
  }
  if (!Number.isFinite(input.count) || input.count < 0) {
    throw new Error("count must be a non-negative number");
  }
  const excluded = new Set(input.excludedDates || []);
  const startParts = partsFromInstant(input.startAt, input.timezone);

  const slots: ScheduledSlot[] = [];
  for (let index = 0; index < input.count; index++) {
    let targetParts = addCalendarDays(startParts, index * input.intervalDays);
    let shifted = false;
    let guard = 0;
    while (excluded.has(dateKey(targetParts)) && guard < 3660) {
      targetParts = addCalendarDays(targetParts, 1);
      shifted = true;
      guard++;
    }
    slots.push({
      index,
      scheduledAt: zonedPartsToUtc(targetParts, input.timezone),
      localDate: dateKey(targetParts),
      shiftedForExclusion: shifted,
    });
  }
  return slots;
}

// Used by "recalculate schedule": finds the next instant at or after
// referenceInstant that shares timeOfDayFrom's local wall-clock
// hour/minute/second in timeZone - i.e. "the next occurrence of the
// series' usual posting time, today if it hasn't passed yet, otherwise
// tomorrow". Feeding this result into computeScheduleDates as startAt
// re-spaces the remaining posts from the right moment without silently
// adopting whatever time-of-day someone happened to click the button at.
export function nextOccurrenceAtOrAfter(referenceInstant: Date, timeOfDayFrom: Date, timeZone: string): Date {
  const timeParts = partsFromInstant(timeOfDayFrom, timeZone);
  const refParts = partsFromInstant(referenceInstant, timeZone);
  let candidateParts: ZonedDateParts = {
    year: refParts.year, month: refParts.month, day: refParts.day,
    hour: timeParts.hour, minute: timeParts.minute, second: timeParts.second,
  };
  let candidate = zonedPartsToUtc(candidateParts, timeZone);
  if (candidate.getTime() < referenceInstant.getTime()) {
    candidateParts = addCalendarDays(candidateParts, 1);
    candidate = zonedPartsToUtc(candidateParts, timeZone);
  }
  return candidate;
}
