// Frontend timezone helpers for the Content module. The DST-safe conversion
// algorithm mirrors supabase/functions/_shared/contentSchedule.ts - it's
// duplicated here only because the edge function (Deno) and this frontend
// (browser) are separate runtimes with no shared import path.
//
// Unlike Acapolite's socialTimezone.ts (a single hardcoded
// BUSINESS_TIMEZONE constant), every function here takes the timezone as a
// parameter - callers pass the active workspace's workspace_settings.timezone.

function partsFromInstant(instant: Date, timeZone: string) {
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
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

// Converts local wall-clock components (as typed into a <input type="datetime-local">
// for the given timezone) into the correct UTC instant, DST-safe.
export function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = new Date(guessUtcMs);
  const interpreted = partsFromInstant(guess, timeZone);
  const interpretedMs = Date.UTC(interpreted.year, interpreted.month - 1, interpreted.day, interpreted.hour, interpreted.minute, interpreted.second);
  const driftMs = interpretedMs - guessUtcMs;
  return new Date(guessUtcMs - driftMs);
}

// Parses a <input type="datetime-local"> string ("YYYY-MM-DDTHH:mm") as a
// wall-clock time in `timeZone` and returns the UTC instant.
export function parseLocalDateTimeInZone(value: string, timeZone: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  return zonedDateTimeToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), timeZone);
}

// Formats a UTC instant back into a <input type="datetime-local"> value
// representing its wall-clock time in `timeZone`.
export function toLocalDateTimeInputValue(date: Date, timeZone: string): string {
  const parts = partsFromInstant(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatInTimezone(date: Date | string, timeZone: string, options: Intl.DateTimeFormatOptions = {}): string {
  const instant = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  }).format(instant);
}
