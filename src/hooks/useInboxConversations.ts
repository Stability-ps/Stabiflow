import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type InboxConversationRow = {
  id: string;
  wa_id: string;
  phone_number: string;
  display_name: string | null;
  status: "active" | "human_handoff" | "closed";
  ai_enabled: boolean;
  inbox_status: "new" | "unassigned" | "assigned" | "waiting_client" | "resolved";
  priority_level: "normal" | "high" | "urgent";
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  ai_summary: string | null;
  intake_missing_fields: string[];
  intake_payload: Record<string, unknown>;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  updated_at: string;
  lead_id: string | null;
  intake_schema_id: string | null;
  intake_completed_at: string | null;
  customer_id: string | null;
};

const CONVERSATION_COLUMNS =
  "id, wa_id, phone_number, display_name, status, ai_enabled, inbox_status, priority_level, assigned_staff_id, assigned_staff_name, ai_summary, intake_missing_fields, intake_payload, last_inbound_at, last_outbound_at, updated_at, lead_id, intake_schema_id, intake_completed_at, customer_id";

export function useInboxConversations(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["inbox-conversations", workspaceId],
    queryFn: async (): Promise<InboxConversationRow[]> => {
      const { data, error } = await supabase
        .from("inbox_conversations")
        .select(CONVERSATION_COLUMNS)
        .eq("workspace_id", workspaceId as string)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return data as InboxConversationRow[];
    },
    enabled: !!workspaceId,
    refetchInterval: 30_000, // belt-and-braces alongside Realtime, matching the source implementation
  });

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel(`inbox-conversations-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "inbox_conversations", filter: `workspace_id=eq.${workspaceId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["inbox-conversations", workspaceId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "inbox_alerts", filter: `workspace_id=eq.${workspaceId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["inbox-conversations", workspaceId] });
        queryClient.invalidateQueries({ queryKey: ["inbox-alerts", workspaceId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, queryClient]);

  return query;
}

export function useInboxConversationReads(workspaceId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["inbox-conversation-reads", workspaceId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("inbox_conversation_reads").select("conversation_id, last_read_at").eq("staff_id", user!.id);
      if (error) throw new Error(error.message);
      return new Map((data || []).map((row) => [row.conversation_id, row.last_read_at as string]));
    },
    enabled: !!workspaceId && !!user?.id,
  });
}

export function isConversationUnread(conversation: InboxConversationRow, lastReadAt: string | undefined): boolean {
  if (!conversation.last_inbound_at) return false;
  if (!lastReadAt) return true;
  return new Date(conversation.last_inbound_at).getTime() > new Date(lastReadAt).getTime();
}
