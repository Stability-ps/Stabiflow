// Admin date ranges, kept in the URL (?range=30d or ?range=custom&from=&to=)
// so a range survives navigation between analytics screens and can be shared.
// Ranges are half-open [from, to) in the viewer's local time.

export const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "this_year", label: "This year" },
  { key: "custom", label: "Custom range" },
] as const;
export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];
export const DEFAULT_RANGE: RangeKey = "30d";
export const MAX_RANGE_DAYS = 400;

export type ResolvedRange = { key: RangeKey; from: Date; to: Date; label: string };

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Parses yyyy-mm-dd as a LOCAL date (Date("yyyy-mm-dd") would be UTC). */
export function parseDay(s: string | null): Date | null {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

export function formatDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isRangeKey(v: string | null): v is RangeKey {
  return RANGE_PRESETS.some((p) => p.key === v);
}

export function resolveRange(params: URLSearchParams, now: Date = new Date()): ResolvedRange {
  const raw = params.get("range");
  const key: RangeKey = isRangeKey(raw) ? raw : DEFAULT_RANGE;
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const label = RANGE_PRESETS.find((p) => p.key === key)!.label;
  switch (key) {
    case "today": return { key, from: today, to: tomorrow, label };
    case "yesterday": return { key, from: addDays(today, -1), to: today, label };
    case "7d": return { key, from: addDays(today, -6), to: tomorrow, label };
    case "30d": return { key, from: addDays(today, -29), to: tomorrow, label };
    case "90d": return { key, from: addDays(today, -89), to: tomorrow, label };
    case "this_month": return { key, from: new Date(today.getFullYear(), today.getMonth(), 1), to: tomorrow, label };
    case "last_month": return { key, from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 1), label };
    case "this_quarter": return { key, from: new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1), to: tomorrow, label };
    case "this_year": return { key, from: new Date(today.getFullYear(), 0, 1), to: tomorrow, label };
    case "custom": {
      const from = parseDay(params.get("from"));
      const toDay = parseDay(params.get("to"));
      if (!from || !toDay || toDay < from) return resolveRange(new URLSearchParams(`range=${DEFAULT_RANGE}`), now);
      const to = addDays(toDay, 1);
      const clampedFrom = (to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS ? addDays(to, -MAX_RANGE_DAYS) : from;
      return { key, from: clampedFrom, to, label: `${formatDay(clampedFrom)} – ${formatDay(toDay)}` };
    }
  }
}

/** Search params that carry a range across admin screens. */
export function rangeParams(params: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const k of ["range", "from", "to"]) {
    const v = params.get(k);
    if (v) out.set(k, v);
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}
