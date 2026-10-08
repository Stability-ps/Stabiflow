import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Matches workspace_settings.currency's own DB default
// (20260828060000_workspace_settings_profile_and_assets.sql) - a
// workspace that hasn't touched Settings yet is still genuinely ZAR, not
// an assumption made up here.
const DEFAULT_CURRENCY = "ZAR";

// Every monetary display that has no real per-row currency to preserve
// (an empty/zero KPI) reads the WORKSPACE's own currency from here rather
// than assuming USD - mirrors the existing useWorkspaceTimezone pattern
// exactly (same table, same query shape, same safe-default discipline).
export function useWorkspaceCurrency(workspaceId: string | null) {
  const query = useQuery({
    queryKey: ["workspace-currency", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspace_settings").select("currency").eq("workspace_id", workspaceId as string).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.currency || DEFAULT_CURRENCY;
    },
    enabled: !!workspaceId,
  });
  return query.data || DEFAULT_CURRENCY;
}
