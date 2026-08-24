import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Demonstrates the workspace-scoped query-key pattern every future
// tenant-owned query must follow: the workspace id is part of the key,
// so workspace A's cached result and workspace B's are two entirely
// separate cache entries. Switching workspaces never shows A's rows
// while B's are loading - there IS no shared entry to show stale data
// from. See WorkspaceSwitcher for the query-cancellation half of this.
export function useWorkspaceActivity(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-activity", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_activity_log")
        .select("*")
        .eq("workspace_id", workspaceId as string)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}
