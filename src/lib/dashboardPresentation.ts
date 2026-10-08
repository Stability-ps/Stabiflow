import { formatMoneyByCurrency, summarizeCurrency, type MoneyByCurrency } from "@/lib/analytics";

export type CurrentIntegration = { provider: string; status: string };

export function hasCurrentIntegration(rows: CurrentIntegration[], provider: "meta" | "whatsapp"): boolean {
  return rows.some((row) => row.provider === provider && row.status === "connected");
}

export function dashboardMoneyValue(rows: MoneyByCurrency, workspaceCurrency: string): string | undefined {
  return summarizeCurrency(rows).kind === "empty" ? undefined : formatMoneyByCurrency(rows, workspaceCurrency);
}

export function dashboardConversationValue(count: number, whatsappConnected: boolean): string | undefined {
  return whatsappConnected || count > 0 ? String(count) : undefined;
}

/** True when the rows hold a single currency whose measured total is exactly 0. */
export function isMeasuredZeroMoney(rows: MoneyByCurrency): boolean {
  const total = summarizeCurrency(rows);
  return total.kind === "single" && total.amountMinor === 0;
}

export type HomeMetricState =
  | { kind: "value"; value: string; note?: string }
  | { kind: "zero"; value?: string; note?: string }
  | { kind: "no_data"; note?: string }
  | { kind: "not_connected"; note: string }
  | { kind: "locked"; plan: string; note?: string };

/**
 * Picks the honest Metric state for a Home KPI, in priority order:
 * locked by plan > integration not connected > no data > measured zero >
 * value. Missing, disconnected and locked data are never shown as 0.
 */
export function homeMetricState(opts: {
  /** Plan that includes the module when the workspace's plan doesn't. */
  lockedPlan?: string | null;
  /** false when the integration feeding this metric isn't connected. */
  connected?: boolean;
  connectNote?: string;
  value: string | undefined;
  measuredZero?: boolean;
  note?: string;
  zeroNote?: string;
  noDataNote?: string;
}): HomeMetricState {
  if (opts.lockedPlan) return { kind: "locked", plan: opts.lockedPlan, note: "Not included in your current plan" };
  if (opts.connected === false) return { kind: "not_connected", note: opts.connectNote ?? "Connect to start tracking" };
  if (opts.value === undefined) return { kind: "no_data", note: opts.noDataNote };
  if (opts.measuredZero) return { kind: "zero", value: opts.value, note: opts.zeroNote };
  return { kind: "value", value: opts.value, note: opts.note };
}

/** "Good morning" / "Good afternoon" / "Good evening" in the workspace's timezone. */
export function greetingFor(now: Date, timeZone: string): string {
  let hour = now.getHours();
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  } catch {
    // Unknown timezone - fall back to the device clock.
  }
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
