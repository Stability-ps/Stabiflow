import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WorkspaceCommercialStatus = "trial" | "active" | "suspended" | "cancelled";

// Display-only - the real enforcement is server-side (see
// supabase/functions/_shared/workspaceStatus.ts's assertWorkspaceActive,
// checked at every costly/mutating edge function). This hook only drives
// the UI banner and any client-side disabling of buttons for a nicer
// experience; a suspended workspace's writes are blocked by the server
// regardless of what this hook returns.
export function useWorkspaceStatus(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-status", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspace_billing").select("status, trial_ends_at").eq("workspace_id", workspaceId as string).single();
      if (error) throw new Error(error.message);
      return { status: data.status as WorkspaceCommercialStatus, trialEndsAt: data.trial_ends_at as string | null };
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}
