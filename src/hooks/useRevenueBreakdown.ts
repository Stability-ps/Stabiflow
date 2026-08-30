import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "@/lib/analyticsDate";
import { summarizeCurrency, type MoneyByCurrency } from "@/lib/analytics";

export type RevenueBreakdownDimension = "source" | "assist" | "day";

export type RevenueBreakdownRow = {
  dimension: RevenueBreakdownDimension;
  bucket_key: string;
  bucket_label: string;
  revenue: MoneyByCurrency;
  event_count: number;
};

export type RevenueBreakdown = {
  source: RevenueBreakdownRow[];
  assist: RevenueBreakdownRow[];
  day: RevenueBreakdownRow[];
  isLoading: boolean;
  isError: boolean;
};

// Order rows for DISPLAY (audit M15 / §20): when every row in the group is
// a single currency, sort by amount descending (a Revenue screen should
// lead with the biggest bucket). If any row is mixed-currency we cannot
// compare magnitudes honestly, so fall back to event_count descending.
function sortForDisplay(rows: RevenueBreakdownRow[]): RevenueBreakdownRow[] {
  const anyMixed = rows.some((r) => summarizeCurrency(r.revenue).kind === "mixed");
  return [...rows].sort((a, b) => {
    if (!anyMixed) {
      const at = summarizeCurrency(a.revenue);
      const bt = summarizeCurrency(b.revenue);
      const av = at.kind === "single" ? at.amountMinor : 0;
      const bv = bt.kind === "single" ? bt.amountMinor : 0;
      if (av !== bv) return bv - av;
    }
    return b.event_count - a.event_count;
  });
}

// Wraps get_revenue_breakdown() - ONE call returns all three dimensions
// (dimension column). Returns empty arrays for a caller without
// view_analytics + revenue.view (the RPC self-gates, never errors).
export function useRevenueBreakdown(workspaceId: string | null, range: DateRange | null): RevenueBreakdown {
  const q = useQuery({
    queryKey: ["revenue-breakdown", workspaceId, range?.from.toISOString(), range?.to.toISOString()],
    enabled: !!workspaceId && !!range,
    queryFn: async (): Promise<RevenueBreakdownRow[]> => {
      const { data, error } = await supabase.rpc("get_revenue_breakdown", {
        p_workspace_id: workspaceId as string,
        p_date_from: range!.from.toISOString(),
        p_date_to: range!.to.toISOString(),
      });
      if (error) throw new Error(error.message);
      return (data || []) as RevenueBreakdownRow[];
    },
  });

  return useMemo(() => {
    const rows = q.data ?? [];
    const pick = (d: RevenueBreakdownDimension) => rows.filter((r) => r.dimension === d);
    return {
      source: sortForDisplay(pick("source")),
      assist: sortForDisplay(pick("assist")),
      // day: chronological, not by magnitude
      day: [...pick("day")].sort((a, b) => a.bucket_key.localeCompare(b.bucket_key)),
      isLoading: q.isLoading,
      isError: q.isError,
    };
  }, [q.data, q.isLoading, q.isError]);
}
