// Phase 12 - WhatsApp business hours (frontend). The AUTHORITATIVE
// open/closed + business-minute calculation lives in SQL
// (workspace_is_open_at / business_minutes_between / sla_sweep). This file
// only:
//   * shapes the seven-row weekly schedule for the Settings form
//   * validates it before a write (mirrors the DB CHECK constraints, so a
//     bad interval is rejected client-side too - the DB stays authoritative)
//   * derives a DISPLAY-ONLY "Open now / Closed now" badge, using the same
//     Intl.DateTimeFormat IANA technique as analyticsDate.ts (no new
//     dependency). This badge is cosmetic; nothing depends on it.
//
// Contract (documented, enforced by the DB): ONE same-day interval per
// weekday, opens_at < closes_at, no overnight, no split shifts.

export type BusinessHoursDay = {
  day_of_week: number; // ISO: 1=Mon .. 7=Sun
  is_open: boolean;
  opens_at: string | null;  // "HH:MM" (or "HH:MM:SS" from the DB)
  closes_at: string | null;
};

export const DAY_LABELS: Record<number, string> = {
  1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday",
};

export const ORDERED_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Mon-Fri 08:00-17:00 open, weekend closed - the same inert default the
 * migration backfills, used when a workspace has no rows yet. */
export function defaultSchedule(): BusinessHoursDay[] {
  return ORDERED_DAYS.map((d) => ({
    day_of_week: d,
    is_open: d >= 1 && d <= 5,
    opens_at: d >= 1 && d <= 5 ? "08:00" : null,
    closes_at: d >= 1 && d <= 5 ? "17:00" : null,
  }));
}

/** Normalise DB rows (possibly partial / "HH:MM:SS") into a full ordered
 * seven-day schedule the form can bind to. */
export function toSchedule(rows: Array<Partial<BusinessHoursDay>> | null | undefined): BusinessHoursDay[] {
  const byDay = new Map<number, Partial<BusinessHoursDay>>();
  for (const r of rows ?? []) if (typeof r.day_of_week === "number") byDay.set(r.day_of_week, r);
  return ORDERED_DAYS.map((d) => {
    const r = byDay.get(d);
    if (!r) return { day_of_week: d, is_open: d <= 5, opens_at: d <= 5 ? "08:00" : null, closes_at: d <= 5 ? "17:00" : null };
    return {
      day_of_week: d,
      is_open: !!r.is_open,
      opens_at: r.is_open ? hhmm(r.opens_at) ?? "08:00" : null,
      closes_at: r.is_open ? hhmm(r.closes_at) ?? "17:00" : null,
    };
  });
}

function hhmm(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{2}):(\d{2})/.exec(v.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

function toMinutes(hhmmStr: string | null): number | null {
  const m = hhmm(hhmmStr);
  if (!m) return null;
  const [h, mm] = m.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

export type ScheduleValidationError = { day_of_week: number; message: string };

/** Server-mirroring validation. An open day needs both times and
 * opens_at < closes_at (no overnight). Returns [] when valid. */
export function validateSchedule(schedule: BusinessHoursDay[]): ScheduleValidationError[] {
  const errors: ScheduleValidationError[] = [];
  for (const day of schedule) {
    if (!day.is_open) continue;
    const open = toMinutes(day.opens_at);
    const close = toMinutes(day.closes_at);
    if (open === null || close === null) {
      errors.push({ day_of_week: day.day_of_week, message: `${DAY_LABELS[day.day_of_week]}: enter both an opening and a closing time.` });
      continue;
    }
    if (open >= close) {
      errors.push({ day_of_week: day.day_of_week, message: `${DAY_LABELS[day.day_of_week]}: closing time must be after opening time (overnight hours aren't supported).` });
    }
  }
  return errors;
}

export function validateOutsideHoursReply(enabled: boolean, message: string | null | undefined): string | null {
  if (enabled && (!message || message.trim().length === 0)) {
    return "Enter the message customers should receive outside business hours.";
  }
  return null;
}

// --- display-only "Open now / Closed now" ------------------------------

/** Local (workspace-tz) ISO weekday 1..7 and minutes-past-midnight for an
 * instant, via Intl.DateTimeFormat (IANA, DST-correct) - the same
 * no-dependency technique analyticsDate.ts uses. */
function localWeekdayAndMinutes(instant: Date, timeZone: string): { isoDow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit",
  }).formatToParts(instant).reduce((acc: Record<string, string>, p) => { acc[p.type] = p.value; return acc; }, {});
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { isoDow: map[parts.weekday] ?? 1, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** DISPLAY ONLY. Mirrors workspace_is_open_at: is `instant` inside the
 * given weekday's [opens_at, closes_at) in `timeZone`? */
export function isOpenAt(schedule: BusinessHoursDay[], timeZone: string, instant: Date): boolean {
  const { isoDow, minutes } = localWeekdayAndMinutes(instant, timeZone);
  const day = schedule.find((d) => d.day_of_week === isoDow);
  if (!day || !day.is_open) return false;
  const open = toMinutes(day.opens_at);
  const close = toMinutes(day.closes_at);
  if (open === null || close === null) return false;
  return minutes >= open && minutes < close;
}
