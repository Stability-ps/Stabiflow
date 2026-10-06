import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { describeActivity, type ActivityRow, type TimelineEvent } from "@/lib/conversationTimeline";

/** System events for one conversation (and its linked lead), from the
 * member-readable activity log. Workspace-scoped key and filter. */
export function useConversationTimeline(workspaceId: string, conversationId: string, leadId: string | null) {
  return useQuery({
    queryKey: ["conversation-timeline", workspaceId, conversationId, leadId],
    queryFn: async (): Promise<TimelineEvent[]> => {
      const targets = [conversationId, ...(leadId ? [leadId] : [])];
      const { data, error } = await supabase
        .from("workspace_activity_log")
        .select("id, action, target_type, target_id, metadata, created_at, profiles(full_name)")
        .eq("workspace_id", workspaceId)
        .in("target_id", targets)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? [])
        .map((r) => describeActivity({
          id: r.id, action: r.action, target_type: r.target_type, target_id: r.target_id,
          metadata: (r.metadata ?? null) as Record<string, unknown> | null, created_at: r.created_at,
          actor_name: (r.profiles as { full_name: string | null } | null)?.full_name ?? null,
        } satisfies ActivityRow))
        .filter((e): e is TimelineEvent => e !== null);
    },
    refetchInterval: 15_000,
  });
}
