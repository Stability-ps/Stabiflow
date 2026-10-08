// Formatting for admin screens. Money is always shown in its own currency;
// different currencies are never summed together.

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return v.toLocaleString("en-US");
}

export function formatMoney(minor: number | null | undefined, currency: string, opts: { compact?: boolean } = {}): string {
  if (minor === null || minor === undefined) return "—";
  const major = Number(minor) / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency, currencyDisplay: "code",
      notation: opts.compact && Math.abs(major) >= 100_000 ? "compact" : "standard",
      maximumFractionDigits: opts.compact ? 0 : 2, minimumFractionDigits: opts.compact ? 0 : 2,
    }).format(major).replace(/ /g, " ");
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `USD ${Number(n).toFixed(Number(n) < 10 ? 4 : 2)}`;
}

export function formatPercent(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return formatDate(iso);
}

export function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  const t = s.replace(/[._]/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
