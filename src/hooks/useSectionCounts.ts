import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// One head-only count query per table (no rows transferred, just the
// count), run in parallel - mirrors useOnboardingStatus's headCount
// helper. Used for the cheap "N customers / N leads" hints on the
// Business/Marketing section landing pages, never a full row fetch just
// to display a number.
async function headCount(table: string, workspaceId: string) {
  const { count, error } = await supabase.from(table as any).select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type BusinessSectionCounts = { customers: number; leads: number; documents: number };

export function useBusinessSectionCounts(workspaceId: string | null, enabled: { customers: boolean; leads: boolean }) {
  return useQuery({
    queryKey: ["business-section-counts", workspaceId, enabled.customers, enabled.leads],
    queryFn: async (): Promise<BusinessSectionCounts> => {
      const id = workspaceId as string;
      const [customers, leads, documents] = await Promise.all([
        enabled.customers ? headCount("customers", id) : Promise.resolve(0),
        enabled.leads ? headCount("leads", id) : Promise.resolve(0),
        headCount("business_documents", id),
      ]);
      return { customers, leads, documents };
    },
    enabled: !!workspaceId,
  });
}

export type MarketingSectionCounts = { posts: number; campaigns: number; creatives: number };

export function useMarketingSectionCounts(workspaceId: string | null, enabled: { content: boolean; campaigns: boolean; creativeStudio: boolean }) {
  return useQuery({
    queryKey: ["marketing-section-counts", workspaceId, enabled.content, enabled.campaigns, enabled.creativeStudio],
    queryFn: async (): Promise<MarketingSectionCounts> => {
      const id = workspaceId as string;
      const [posts, campaigns, creatives] = await Promise.all([
        enabled.content ? headCount("content_scheduled_posts", id) : Promise.resolve(0),
        enabled.campaigns ? headCount("ad_campaigns", id) : Promise.resolve(0),
        enabled.creativeStudio ? headCount("creative_studio_batches", id) : Promise.resolve(0),
      ]);
      return { posts, campaigns, creatives };
    },
    enabled: !!workspaceId,
  });
}
