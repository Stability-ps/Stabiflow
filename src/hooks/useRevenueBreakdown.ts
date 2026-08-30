import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "@/lib/analyticsDate";
import type { MoneyByCurrency } from "@/lib/analytics";

export type RevenueBreakdownDimension = "source" | "assist" | "day";

export type RevenueBreakdownRow = {
  bucket_key: string;
  bucket_label: string;
  revenue: MoneyByCurrency;
  event_count: number;
};

// Wraps get_revenue_breakdown() (20260919060000_revenue_breakdown_read_model.sql).
// Returns [] for a caller without view_analytics + revenue.view (the RPC
// self-gates and returns an empty set - never an error).
export function useRevenueBreakdown(workspaceId: string | null, range: DateRange | null, dimension: RevenueBreakdownDimension) {
  return useQuery({
    queryKey: ["revenue-breakdown", workspaceId, range?.from.toISOString(), range?.to.toISOString(), dimension],
    enabled: !!workspaceId && !!range,
    queryFn: async (): Promise<RevenueBreakdownRow[]> => {
      const { data, error } = await supabase.rpc("get_revenue_breakdown", {
        p_workspace_id: workspaceId as string,
        p_date_from: range!.from.toISOString(),
        p_date_to: range!.to.toISOString(),
        p_dimension: dimension,
      });
      if (error) throw new Error(error.message);
      return (data || []) as RevenueBreakdownRow[];
    },
  });
}
