import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toFlagLookup, type EvaluatedFlag, type FlagLookup } from "@/lib/featureFlags";

export const ADVANCED_MODULE_FLAGS = [
  "module.content",
  "module.campaigns",
  "module.creative_studio",
  "module.whatsapp",
  "module.leads",
  "module.customers",
  "module.analytics",
  "module.flow_ai",
  "module.automations",
  "module.integrations",
] as const;

/**
 * Evaluated feature flags for the current workspace. Display gating only -
 * the database evaluator is authoritative and operators are resolved
 * there. Unloaded/unknown flags read as OFF.
 */
export function useFeatureFlags(): { isEnabled: FlagLookup; isLoading: boolean; hasAdvancedModules: boolean } {
  const { currentWorkspaceId } = useAuth();
  const query = useQuery({
    queryKey: ["feature-flags", currentWorkspaceId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("evaluate_feature_flags", { p_workspace_id: currentWorkspaceId as string });
      if (error) throw new Error(error.message);
      return (data ?? []) as EvaluatedFlag[];
    },
    enabled: !!currentWorkspaceId,
    staleTime: 60_000,
  });
  const isEnabled = toFlagLookup(query.data);
  return {
    isEnabled,
    isLoading: query.isLoading,
    hasAdvancedModules: ADVANCED_MODULE_FLAGS.some((k) => isEnabled(k)),
  };
}
