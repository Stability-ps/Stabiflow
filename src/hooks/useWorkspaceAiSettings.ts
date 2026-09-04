import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WorkspaceAiSettings = {
  ai_multimodal_enabled: boolean;
  /** Phase 10: when true, a customer voice note's audio may be sent to the
   * AI provider to produce a text transcript. Defaults OFF. */
  ai_voice_transcription_enabled: boolean;
  /** Phase 13: when true, an AI-generated WhatsApp reply may get one extra
   * AI pass that adapts it to the customer's language / style. Presentation
   * only - the original semantic reply stays authoritative. Defaults OFF. */
  match_customer_language: boolean;
};

/** Reads the workspace AI config from workspace_settings (member-readable).
 * Phase 6: ai_multimodal_enabled gates whether customer images/PDFs may be
 * sent to the AI provider. Phase 10: ai_voice_transcription_enabled gates
 * voice-note transcription. Both default OFF. */
export function useWorkspaceAiSettings(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-ai-settings", workspaceId],
    queryFn: async (): Promise<WorkspaceAiSettings> => {
      const { data, error } = await supabase
        .from("workspace_settings")
        .select("ai_multimodal_enabled, ai_voice_transcription_enabled, match_customer_language")
        .eq("workspace_id", workspaceId as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return {
        ai_multimodal_enabled: data?.ai_multimodal_enabled ?? false,
        ai_voice_transcription_enabled: data?.ai_voice_transcription_enabled ?? false,
        match_customer_language: data?.match_customer_language ?? false,
      };
    },
    enabled: !!workspaceId,
  });
}

/** Admin-only update (RLS: has_workspace_role(workspace_id, 'admin')). */
export async function updateWorkspaceAiSettings(
  workspaceId: string,
  input: Partial<Pick<WorkspaceAiSettings, "ai_multimodal_enabled" | "ai_voice_transcription_enabled" | "match_customer_language">>,
) {
  const { error } = await supabase
    .from("workspace_settings")
    .update(input)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}
