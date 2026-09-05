// Campaign scheduling model (client side).
//
// A campaign's schedule is a timezone-aware DATE + TIME the user authors in
// their WORKSPACE timezone, or "Start now" (no timestamp at all).
//
//   workspace-local date + time  --zonedDateTimeToUtc-->  UTC instant  (ad_campaigns.start_at)
//   "Start now"                                            null
//
// The server (supabase/functions/_shared/adMoney.ts) is authoritative: it
// re-validates the instant against the real current time immediately before
// any Meta publish. There is NO artificial minimum buffer - any genuinely
// future instant is acceptable, and null (Start now) always is.
import { zonedDateTimeToUtc } from "@/lib/contentTimezone";
import { localDateString } from "@/lib/analyticsDate";

function timeHM(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

function dateDMY(d: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d)
    .reduce((acc: Record<string, string>, part) => { acc[part.type] = part.value; return acc; }, {});
  return `${p.day}/${p.month}/${p.year}`;
}

// Matches useWorkspaceTimezone / useWorkspaceActivity's own fallback so a
// missing/broken zone degrades to the same default the rest of the app uses
// rather than crashing (Intl throws on an unknown IANA name).
export const WORKSPACE_TIMEZONE_FALLBACK = "Africa/Johannesburg";

// A SCHEDULED start must be at least this far ahead of "now" to be
// publishable - the publish pipeline (readiness gate -> create campaign ->
// create ad set) adds latency, and Meta rejects a past ad-set start_time.
// A start that is closer than this (or has passed) is a blocking readiness
// issue, NOT a silent conversion to "Start now". Mirrors
// supabase/functions/_shared/adMoney.ts (MIN_SCHEDULED_START_LEAD_MS) -
// keep the two values in sync.
export const MIN_SCHEDULED_START_LEAD_MS = 2 * 60 * 1000;

export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return WORKSPACE_TIMEZONE_FALLBACK;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    return WORKSPACE_TIMEZONE_FALLBACK;
  }
}

export type StartMode = "now" | "scheduled";

/** Parse a "YYYY-MM-DD" date + "HH:mm" time as wall-clock in `timeZone` -> UTC instant. null on malformed input. */
export function localDateTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  const tm = /^(\d{2}):(\d{2})$/.exec(timeStr || "");
  if (!dm || !tm) return null;
  const [, y, mo, d] = dm;
  const [, h, mi] = tm;
  const instant = zonedDateTimeToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), safeTimeZone(timeZone));
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** A stored UTC instant -> the workspace-local { date: "YYYY-MM-DD", time: "HH:mm" } to hydrate the editor. */
export function utcToLocalDateTimeParts(iso: string, timeZone: string): { date: string; time: string } {
  const d = new Date(iso);
  const tz = safeTimeZone(timeZone);
  const date = localDateString(d, tz); // "YYYY-MM-DD"
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return { date, time };
}

/**
 * True when a SCHEDULED start instant has passed OR is now too close to
 * publish safely (within MIN_SCHEDULED_START_LEAD_MS of `now`) - the exact
 * condition the server-side readiness rule (adMoney.ts) blocks on, so the
 * Campaign Detail hint and readiness never disagree. "Start now"
 * (startAt === null) is never too close. Instant-vs-instant; timezone only
 * mattered when the user's local date+time was converted TO the instant.
 */
export function isScheduledStartTooCloseOrPast(startAt: string | null, now: Date): boolean {
  if (!startAt) return false;
  const t = new Date(startAt).getTime();
  return !Number.isNaN(t) && t <= now.getTime() + MIN_SCHEDULED_START_LEAD_MS;
}

/** Compact schedule label for the campaigns list. "Starts now" | "Today, 14:30" | "01/09/2026, 09:00". */
export function formatScheduleSummary(startAt: string | null, timeZone: string, now: Date): string {
  if (!startAt) return "Starts now";
  const tz = safeTimeZone(timeZone);
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return "-";
  const time = timeHM(d, tz);
  if (localDateString(d, tz) === localDateString(now, tz)) return `Today, ${time}`;
  return `${dateDMY(d, tz)}, ${time}`;
}

/** Full schedule line for Campaign Detail: "Start now" or "01/09/2026, 09:00" (workspace-local). */
export function formatScheduleStart(startAt: string | null, timeZone: string): string {
  if (!startAt) return "Start now";
  const tz = safeTimeZone(timeZone);
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return "-";
  return `${dateDMY(d, tz)}, ${timeHM(d, tz)}`;
}
