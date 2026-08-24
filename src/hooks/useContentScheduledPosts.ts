import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ScheduledPostStatusFilter = "scheduled" | "published" | "failed" | "draft" | "all";

// "scheduled" includes failed posts too: there is no separate Failed nav
// tab (see the Content shell's suggested subsections), but failed content
// must still be visible (Phase 5 requirement) - it shows up here, still
// queued conceptually, with its failure reason and a way to retry/cancel.
type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled" | "skipped";

const STATUS_GROUPS: Record<Exclude<ScheduledPostStatusFilter, "all">, PostStatus[]> = {
  scheduled: ["scheduled", "publishing", "failed"],
  published: ["published"],
  failed: ["failed"],
  draft: ["draft"],
};

// Workspace-scoped (see useContentMediaAssets.ts for the same pattern) AND
// status-scoped: the Scheduled/Published/Failed/Drafts tabs are each a
// distinct cache entry, so switching tabs never flashes another tab's
// stale rows while the new query is loading.
export function useContentScheduledPosts(workspaceId: string | null, statusFilter: ScheduledPostStatusFilter, range?: { from: string; to: string }) {
  return useQuery({
    queryKey: ["content-scheduled-posts", workspaceId, statusFilter, range?.from ?? null, range?.to ?? null],
    queryFn: async () => {
      let query = supabase
        .from("content_scheduled_posts")
        .select(`
          id, target_platform, facebook_page_id, instagram_account_id, media_asset_id, platform_variant_id,
          scheduled_at, caption, status, attempt_count, failure_code, failure_message, published_at,
          provider_permalink, next_retry_at, series_id,
          content_media_assets(id, title, storage_path, mime_type),
          workspace_facebook_pages(page_name),
          workspace_instagram_accounts(username)
        `)
        .eq("workspace_id", workspaceId as string)
        .order("scheduled_at", { ascending: statusFilter !== "published" });

      if (statusFilter !== "all") query = query.in("status", STATUS_GROUPS[statusFilter]);
      if (range) query = query.gte("scheduled_at", range.from).lte("scheduled_at", range.to);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}
