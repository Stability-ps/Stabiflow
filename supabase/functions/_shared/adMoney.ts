// Budget/money handling for the Campaigns module (Phase 6 instruction #16
// - "budget handling is high-risk"). Pure functions, no I/O, so this is
// exhaustively unit-testable without a network call.
//
// Money is ALWAYS represented in minor units (integer cents) once it
// leaves the UI's decimal input - see ad_campaigns.daily_budget_minor_units/
// lifetime_budget_minor_units in the schema migration. Meta's own Marketing
// API also bills in minor units for most currencies (with a documented list
// of zero-decimal exceptions), which this module does NOT special-case
// (documented limitation below) - StabiFlow does no autonomous currency
// conversion (instruction #16: "do not silently convert currency"), so the
// currency stored on a campaign is asserted, never inferred, from the
// selected ad account's own currency.

export type BudgetType = "daily" | "lifetime";

// Meta's documented per-currency minimum daily budget floor is roughly
// USD 1.00 equivalent (varies by currency, not exhaustively published).
// StabiFlow enforces a conservative, currency-agnostic floor here as a
// sanity check, not a substitute for Meta's own account-level minimum,
// which the readiness/publish layer surfaces from the actual API error if
// exceeded.
export const MIN_DAILY_BUDGET_MINOR_UNITS = 100; // smallest-unit-agnostic floor; see limitation note above
export const MIN_LIFETIME_BUDGET_MINOR_UNITS = 100;
export const MAX_BUDGET_MINOR_UNITS = 100_000_000_00; // R100,000,000.00 equivalent - a sanity ceiling against fat-finger input, not a Meta limit

export type MoneyInput = {
  budgetType: BudgetType;
  dailyBudgetMinorUnits: number | null;
  lifetimeBudgetMinorUnits: number | null;
  currency: string;
  // The scheduled start INSTANT (UTC), or null for "Start now" (immediate
  // publish - the Meta ad set is created with no start_time). The client is
  // responsible for converting the user's workspace-local date + time into
  // this instant; the server only compares instants.
  startAt: Date | null;
  endAt: Date | null;
  // Injected clock, for deterministic tests (repo convention: no hidden
  // Date.now() in pure modules). Defaults to the real now.
  now?: Date;
};

export type MoneyValidationResult = { valid: true } | { valid: false; issues: string[] };

const ISO_4217_PATTERN = /^[A-Z]{3}$/;

export function convertDecimalToMinorUnits(decimalAmount: number): number {
  if (!Number.isFinite(decimalAmount)) return NaN;
  // Round, don't truncate - a truncating conversion of 10.995 would
  // silently under-charge the budget the user actually typed.
  return Math.round(decimalAmount * 100);
}

export function formatMinorUnitsAsDecimal(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}

export function validateCampaignBudget(input: MoneyInput): MoneyValidationResult {
  const issues: string[] = [];

  if (!ISO_4217_PATTERN.test(input.currency)) {
    issues.push(`currency must be a 3-letter ISO 4217 code, got "${input.currency}"`);
  }

  if (input.budgetType === "daily") {
    if (input.lifetimeBudgetMinorUnits !== null) {
      issues.push("a daily-budget campaign must not also set a lifetime budget");
    }
    if (input.dailyBudgetMinorUnits === null) {
      issues.push("daily_budget_minor_units is required for budget_type 'daily'");
    } else if (!Number.isInteger(input.dailyBudgetMinorUnits)) {
      issues.push("daily_budget_minor_units must be an integer (minor units, not a decimal amount)");
    } else if (input.dailyBudgetMinorUnits < MIN_DAILY_BUDGET_MINOR_UNITS) {
      issues.push(`daily budget is below the minimum (${formatMinorUnitsAsDecimal(MIN_DAILY_BUDGET_MINOR_UNITS)} ${input.currency || ""})`);
    } else if (input.dailyBudgetMinorUnits > MAX_BUDGET_MINOR_UNITS) {
      issues.push("daily budget exceeds the maximum allowed by StabiFlow");
    }
  } else if (input.budgetType === "lifetime") {
    if (input.dailyBudgetMinorUnits !== null) {
      issues.push("a lifetime-budget campaign must not also set a daily budget");
    }
    if (input.lifetimeBudgetMinorUnits === null) {
      issues.push("lifetime_budget_minor_units is required for budget_type 'lifetime'");
    } else if (!Number.isInteger(input.lifetimeBudgetMinorUnits)) {
      issues.push("lifetime_budget_minor_units must be an integer (minor units, not a decimal amount)");
    } else if (input.lifetimeBudgetMinorUnits < MIN_LIFETIME_BUDGET_MINOR_UNITS) {
      issues.push(`lifetime budget is below the minimum (${formatMinorUnitsAsDecimal(MIN_LIFETIME_BUDGET_MINOR_UNITS)} ${input.currency || ""})`);
    } else if (input.lifetimeBudgetMinorUnits > MAX_BUDGET_MINOR_UNITS) {
      issues.push("lifetime budget exceeds the maximum allowed by StabiFlow");
    }
    if (!input.endAt) {
      issues.push("a lifetime budget requires an end date");
    }
  } else {
    issues.push(`budget_type must be 'daily' or 'lifetime', got "${input.budgetType}"`);
  }

  const now = input.now ?? new Date();

  // Schedule is a timezone-aware DATE + TIME, resolved by the caller to a
  // UTC instant (or null for "Start now"). We compare instants here.
  //
  // End must be strictly after the effective start:
  //  - scheduled start -> after that instant
  //  - "start now" (startAt null) -> after "now"
  const effectiveStartMs = input.startAt ? input.startAt.getTime() : now.getTime();
  if (input.endAt && input.endAt.getTime() <= effectiveStartMs) {
    issues.push("end time must be after the start time");
  }

  // A SCHEDULED start must be in the future. "Start now" (null) is always
  // valid - it publishes immediately. No artificial minimum buffer: the
  // Meta Marketing API only requires an ad set start_time to be after the
  // current time, and StabiFlow omits start_time entirely for an immediate
  // start, so any genuinely-future instant is acceptable.
  if (input.startAt && input.startAt.getTime() <= now.getTime()) {
    issues.push("scheduled start time has passed");
  }

  return issues.length ? { valid: false, issues } : { valid: true };
}
