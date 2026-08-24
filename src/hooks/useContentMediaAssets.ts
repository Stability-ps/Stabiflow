import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Workspace-scoped query key, following the pattern established in
// useWorkspaceActivity.ts: different workspace ids are structurally
// different cache entries, so a workspace switch can never show a
// previous workspace's media while the new one loads.
export function useContentMediaAssets(workspaceId: string | null, status: "active" | "archived" = "active") {
  return useQuery({
    queryKey: ["content-media-assets", workspaceId, status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_media_assets")
        .select("*, content_platform_variants(id, platform, storage_path, width_px, height_px)")
        .eq("workspace_id", workspaceId as string)
        .eq("status", status)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}
