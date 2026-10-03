import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OnboardingCounts } from "@/lib/onboarding";
import { hasCurrentIntegration } from "@/lib/dashboardPresentation";

// One head-only count query per table (no rows transferred, just the
// count) run in parallel, rather than 13 separate round trips worth of
// full row data - this only needs to know "does at least one exist".
async function headCount(table: string, workspaceId: string, extra?: (q: any) => any) {
  let query = supabase.from(table as any).select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if (extra) query = extra(query);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function analyticsVisitedKey(workspaceId: string) {
  return `onboarding-analytics-visited-${workspaceId}`;
}

export function markAnalyticsVisited(workspaceId: string) {
  try {
    localStorage.setItem(analyticsVisitedKey(workspaceId), "1");
  } catch {
    // localStorage can throw in private-browsing/blocked-storage contexts -
    // this is a pure UX nicety, never worth failing the page over.
  }
}

export function useOnboardingStatus(workspaceId: string | null) {
  return useQuery({
    queryKey: ["onboarding-status", workspaceId],
    queryFn: async (): Promise<OnboardingCounts> => {
      const id = workspaceId as string;
      const [
        { count: members },
        integrations,
        { data: pipeline },
        content,
        scheduledContent,
        campaigns,
        conversations,
        leads,
        opportunities,
        flowAiConversations,
        automations,
        { data: settings },
      ] = await Promise.all([
        supabase.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", id),
        supabase.from("workspace_integrations").select("provider, status").eq("workspace_id", id),
        supabase.from("pipelines").select("id").eq("workspace_id", id).limit(1).maybeSingle(),
        headCount("content_media_assets", id),
        headCount("content_scheduled_posts", id),
        headCount("ad_campaigns", id),
        headCount("inbox_conversations", id),
        headCount("leads", id),
        headCount("opportunities", id),
        headCount("ai_conversations", id),
        headCount("automations", id),
        supabase.from("workspace_settings").select("business_description, website, industry").eq("workspace_id", id).maybeSingle(),
      ]);

      const integrationRows = integrations.data ?? [];
      const metaConnected = hasCurrentIntegration(integrationRows, "meta");
      const whatsappConnected = hasCurrentIntegration(integrationRows, "whatsapp");

      let analyticsVisited = false;
      try {
        analyticsVisited = localStorage.getItem(analyticsVisitedKey(id)) === "1";
      } catch {
        analyticsVisited = false;
      }

      return {
        members: members ?? 0,
        metaConnected,
        whatsappConnected,
        defaultPipeline: !!pipeline,
        content: content + scheduledContent,
        campaigns,
        conversations,
        leadsOrOpportunities: leads + opportunities,
        flowAiConversations,
        automations,
        profileComplete: !!(settings?.business_description || settings?.website || settings?.industry),
        analyticsVisited,
      };
    },
    enabled: !!workspaceId,
  });
}
