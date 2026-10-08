import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { BarChart3 } from "lucide-react";
import { formatMoneyByCurrency, summarizeCurrency } from "@/lib/analytics";
import type { RevenueBreakdownRow } from "@/hooks/useRevenueBreakdown";

// A dependency-free horizontal bar list. Bars are sized by the row's
// single-currency amount when the whole set shares one currency; when
// currencies are mixed the bars are hidden (a bar can't honestly compare
// two currencies) and only the per-currency amounts are shown.
function barWidth(row: RevenueBreakdownRow, max: number): number {
  const t = summarizeCurrency(row.revenue);
  if (t.kind !== "single" || max <= 0) return 0;
  return Math.max(2, Math.round((t.amountMinor / max) * 100));
}

export function RevenueBreakdownSection({
  title,
  description,
  rows,
  isLoading,
  isError,
  workspaceCurrency,
  emptyHint,
}: {
  title: string;
  description?: string;
  rows: RevenueBreakdownRow[];
  isLoading: boolean;
  isError: boolean;
  workspaceCurrency: string;
  emptyHint: string;
}) {
  const singleCurrencyMax = rows.reduce((m, r) => {
    const t = summarizeCurrency(r.revenue);
    return t.kind === "single" ? Math.max(m, t.amountMinor) : m;
  }, 0);
  const anyMixed = rows.some((r) => summarizeCurrency(r.revenue).kind === "mixed");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load this breakdown right now.</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={BarChart3} title="No revenue in this range" description={emptyHint} className="border-none py-6" />
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.bucket_key}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{r.bucket_label}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatMoneyByCurrency(r.revenue, workspaceCurrency)}</span>
                </div>
                {!anyMixed && (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${barWidth(r, singleCurrencyMax)}%` }} />
                  </div>
                )}
                <p className="mt-0.5 text-[11px] text-muted-foreground">{r.event_count} revenue event{r.event_count === 1 ? "" : "s"}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
