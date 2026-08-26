import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getOpportunityLabel, type WorkspaceTerminology } from "@/lib/terminology";

// workspace_settings.terminology already exists (Phase 3, unused until
// now) - Leads/Opportunities is the first module to read it, per durable
// rule #12: the underlying `opportunities` table is never renamed per
// workspace, only its UI label is.
export function useOpportunityTerminology(workspaceId: string | null): string {
  const query = useQuery({
    queryKey: ["opportunity-terminology", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspace_settings").select("terminology").eq("workspace_id", workspaceId as string).maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.terminology as WorkspaceTerminology) || {};
    },
    enabled: !!workspaceId,
  });
  return getOpportunityLabel(query.data);
}
