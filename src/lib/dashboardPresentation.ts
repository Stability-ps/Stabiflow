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
