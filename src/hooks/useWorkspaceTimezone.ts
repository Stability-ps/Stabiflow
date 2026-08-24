import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_TIMEZONE = "Africa/Johannesburg";

// Every content-scheduling surface reads the timezone from here rather
// than assuming one global zone (Phase 5 requirement) - workspace_settings
// already carries a real per-workspace timezone from Phase 3.
export function useWorkspaceTimezone(workspaceId: string | null) {
  const query = useQuery({
    queryKey: ["workspace-timezone", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspace_settings").select("timezone").eq("workspace_id", workspaceId as string).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.timezone || DEFAULT_TIMEZONE;
    },
    enabled: !!workspaceId,
  });
  return query.data || DEFAULT_TIMEZONE;
}
