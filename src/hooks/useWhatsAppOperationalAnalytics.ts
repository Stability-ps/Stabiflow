import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "@/lib/analyticsDate";
import type { WhatsAppOperationalAnalytics } from "@/lib/whatsappAnalytics";

// Phase 11: one row of already-aggregated WhatsApp operational metrics for
// [range.from, range.to). The RPC (get_whatsapp_operational_analytics) does
// all the maths server-side and is gated on has_workspace_permission
// (inbox.view) - a workspace switch or range change is a distinct query
// key, never a stale reuse (same convention as useAnalytics.ts).
function rangeKey(range: DateRange | null) {
  return range ? [range.from.toISOString(), range.to.toISOString()] : [null, null];
}

export function useWhatsAppOperationalAnalytics(workspaceId: string | null, range: DateRange | null) {
  return useQuery({
    queryKey: ["whatsapp-operational-analytics", workspaceId, ...rangeKey(range)],
    queryFn: async (): Promise<WhatsAppOperationalAnalytics | null> => {
      const { data, error } = await supabase.rpc("get_whatsapp_operational_analytics", {
        p_workspace_id: workspaceId as string,
        p_date_from: range!.from.toISOString(),
        p_date_to: range!.to.toISOString(),
      });
      if (error) throw new Error(error.message);
      // No row = the caller lacks inbox.view on this workspace. Treat it as
      // "nothing to show" rather than an error wall.
      const row = Array.isArray(data) ? data[0] : data;
      return (row as WhatsAppOperationalAnalytics | undefined) ?? null;
    },
    enabled: !!workspaceId && !!range,
  });
}
