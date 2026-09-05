import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useWorkspaceProfile(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-profile", workspaceId],
    queryFn: async () => {
      const [{ data: workspace, error: workspaceError }, { data: settings, error: settingsError }] = await Promise.all([
        supabase.from("workspaces").select("*").eq("id", workspaceId as string).single(),
        supabase.from("workspace_settings").select("*").eq("workspace_id", workspaceId as string).single(),
      ]);
      if (workspaceError) throw new Error(workspaceError.message);
      if (settingsError) throw new Error(settingsError.message);
      return { workspace, settings };
    },
    enabled: !!workspaceId,
  });
}
