import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SlaSettings } from "@/lib/slaState";

export type WorkspaceSlaSettings = SlaSettings;

/** Reads the workspace SLA config from workspace_settings (member-readable). */
export function useWorkspaceSlaSettings(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-sla-settings", workspaceId],
    queryFn: async (): Promise<WorkspaceSlaSettings> => {
      const { data, error } = await supabase
        .from("workspace_settings")
        .select("handoff_sla_minutes, handoff_sla_enabled")
        .eq("workspace_id", workspaceId as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return {
        handoff_sla_minutes: data?.handoff_sla_minutes ?? 10,
        handoff_sla_enabled: data?.handoff_sla_enabled ?? true,
      };
    },
    enabled: !!workspaceId,
  });
}

/** Admin-only update (RLS: has_workspace_role(workspace_id, 'admin')). */
export async function updateWorkspaceSlaSettings(workspaceId: string, input: { handoff_sla_minutes?: number; handoff_sla_enabled?: boolean }) {
  const patch: { handoff_sla_minutes?: number; handoff_sla_enabled?: boolean } = {};
  if (input.handoff_sla_minutes != null) {
    const n = Math.trunc(input.handoff_sla_minutes);
    if (!Number.isFinite(n) || n < 1 || n > 1440) throw new Error("SLA must be between 1 and 1440 minutes");
    patch.handoff_sla_minutes = n;
  }
  if (input.handoff_sla_enabled != null) patch.handoff_sla_enabled = input.handoff_sla_enabled;
  const { error } = await supabase.from("workspace_settings").update(patch).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}
