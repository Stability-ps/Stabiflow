// Frontend copy of the minor-units money helpers used by the Campaign
// Builder's budget step. The AUTHORITATIVE copy (and the actual validation
// enforced server-side) lives in supabase/functions/_shared/adMoney.ts -
// see that file's header for the full rationale. This file exists only so
// the Builder can convert a decimal input to minor units and format a
// minor-units value back for display, without a network round trip.
export function decimalToMinorUnits(decimalAmount: number): number {
  if (!Number.isFinite(decimalAmount)) return NaN;
  return Math.round(decimalAmount * 100);
}

export function minorUnitsToDecimalString(minorUnits: number | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) return "";
  return (minorUnits / 100).toFixed(2);
}

export function formatMoney(minorUnits: number | null | undefined, currency: string): string {
  if (minorUnits === null || minorUnits === undefined) return "-";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minorUnits / 100);
  } catch {
    return `${currency} ${minorUnitsToDecimalString(minorUnits)}`;
  }
}
