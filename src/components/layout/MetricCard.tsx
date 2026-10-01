import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { periodOverPeriodChange } from "@/lib/analytics";

export type MetricTrend = { direction: "up" | "down"; label: string; tone: "positive" | "negative" | "neutral" };

/** Real percentage change vs the immediately preceding period of equal
 * length (see previousComparisonRange) - never a fabricated delta. Delegates
 * the math to periodOverPeriodChange (analytics.ts) so this and /analytics
 * never disagree on the formula; this just adds the label/tone. Returns
 * null when there's no meaningful previous-period baseline to compare to. */
export function computeTrend(current: number, previous: number): MetricTrend | null {
  if (previous === 0) return current > 0 ? { direction: "up", label: "New", tone: "positive" } : null;
  const change = periodOverPeriodChange(previous, current);
  if (change === null || Math.abs(change) < 0.5) return null;
  const direction = change > 0 ? "up" : "down";
  return { direction, label: `${change > 0 ? "+" : ""}${change.toFixed(1)}% vs previous period`, tone: direction === "up" ? "positive" : "negative" };
}

// `value` is undefined/null when there's genuinely no real data source (or
// permission) behind this metric yet - renders emptyMessage in that case.
// A real, currently-zero value is passed as the STRING "0" (or "$0.00"),
// which renders as a real number - never conflated with "unavailable".
export function MetricCard({ icon: Icon, label, emptyMessage, value, trend }: {
  icon: LucideIcon;
  label: string;
  emptyMessage: string;
  value?: string;
  trend?: MetricTrend | null;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {value !== undefined ? (
          <>
            <p className="text-2xl font-semibold">{value}</p>
            {trend && (
              <p className={cn(
                "mt-1 flex items-center gap-1 text-xs font-medium",
                trend.tone === "positive" && "text-success",
                trend.tone === "negative" && "text-destructive",
                trend.tone === "neutral" && "text-muted-foreground",
              )}
              >
                {trend.direction === "up" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {trend.label}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}
