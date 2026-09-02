import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WorkspaceAiSettings = {
  ai_multimodal_enabled: boolean;
};

/** Reads the workspace AI config from workspace_settings (member-readable).
 * Phase 6: ai_multimodal_enabled gates whether customer images/PDFs may be
 * sent to the AI provider. Defaults OFF. */
export function useWorkspaceAiSettings(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-ai-settings", workspaceId],
    queryFn: async (): Promise<WorkspaceAiSettings> => {
      const { data, error } = await supabase
        .from("workspace_settings")
        .select("ai_multimodal_enabled")
        .eq("workspace_id", workspaceId as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { ai_multimodal_enabled: data?.ai_multimodal_enabled ?? false };
    },
    enabled: !!workspaceId,
  });
}

/** Admin-only update (RLS: has_workspace_role(workspace_id, 'admin')). */
export async function updateWorkspaceAiSettings(workspaceId: string, input: { ai_multimodal_enabled: boolean }) {
  const { error } = await supabase
    .from("workspace_settings")
    .update({ ai_multimodal_enabled: input.ai_multimodal_enabled })
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}
