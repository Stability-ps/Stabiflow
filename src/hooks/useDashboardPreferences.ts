import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PresetId } from "@/lib/dashboard/types";

export type WidgetLayoutEntry = { id: string; visible: boolean };

export type DashboardPreferences = { widgets: WidgetLayoutEntry[]; preset: PresetId | null };

// dashboard_preferences isn't in the generated Supabase types yet (added
// in supabase/migrations/20261019060000_dashboard_preferences.sql, not yet
// applied to any live project) - `as any` on the table name matches the
// existing fallback for not-yet-generated tables (see
// src/hooks/useOnboardingStatus.ts's headCount helper).
export function useDashboardPreferences(workspaceId: string | null, userId: string | null) {
  return useQuery({
    queryKey: ["dashboard-preferences", workspaceId, userId],
    queryFn: async (): Promise<DashboardPreferences | null> => {
      const { data, error } = await supabase
        .from("dashboard_preferences" as any)
        .select("widgets, preset")
        .eq("workspace_id", workspaceId as string)
        .eq("user_id", userId as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const row = data as unknown as { widgets: WidgetLayoutEntry[]; preset: PresetId | null };
      return { widgets: row.widgets ?? [], preset: row.preset };
    },
    enabled: !!workspaceId && !!userId,
  });
}

export function useSaveDashboardPreferences(workspaceId: string | null, userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (prefs: DashboardPreferences) => {
      const { error } = await supabase
        .from("dashboard_preferences" as any)
        .upsert(
          { workspace_id: workspaceId, user_id: userId, widgets: prefs.widgets, preset: prefs.preset },
          { onConflict: "workspace_id,user_id" },
        );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-preferences", workspaceId, userId] });
    },
  });
}
