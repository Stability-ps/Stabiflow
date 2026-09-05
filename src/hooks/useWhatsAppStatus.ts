import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WhatsAppWebhookEvent = { event_type: string; received_at: string };

// The most recent row the whatsapp-webhook edge function wrote for this
// workspace (one row per received Meta event - message | status |
// unknown). This is the only reliable, non-fabricated signal that inbound
// delivery has actually reached StabiFlow. RLS: workspace members can read
// their own workspace's rows (20260829060000_integrations_foundation.sql).
// Read-only - never a mutation.
export function useLastWhatsAppWebhookEvent(workspaceId: string | null) {
  return useQuery({
    queryKey: ["whatsapp-last-webhook-event", workspaceId],
    queryFn: async (): Promise<WhatsAppWebhookEvent | null> => {
      const { data, error } = await supabase
        .from("workspace_whatsapp_webhook_events")
        .select("event_type, received_at")
        .eq("workspace_id", workspaceId as string)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as WhatsAppWebhookEvent | null) ?? null;
    },
    enabled: !!workspaceId,
    refetchInterval: 60_000,
  });
}

// Phase 15: the last <=20 webhook events + what happened after receipt
// (get_recent_whatsapp_webhook_events RPC - integration.view-gated,
// diagnostic-safe columns only, no payload). Complements the single
// "Last inbound webhook event" signal above.
export type RecentWhatsAppWebhookEvent = {
  id: string;
  received_at: string;
  event_type: string;
  phone_number_id: string;
  resolved: boolean;
  outcome: string | null;
  message_type: string | null;
  is_unresolved: boolean;
};

export function useRecentWhatsAppWebhookEvents(workspaceId: string | null, limit = 10) {
  return useQuery({
    queryKey: ["whatsapp-recent-webhook-events", workspaceId, limit],
    queryFn: async (): Promise<RecentWhatsAppWebhookEvent[]> => {
      const { data, error } = await supabase.rpc("get_recent_whatsapp_webhook_events", {
        p_workspace_id: workspaceId as string,
        p_limit: limit,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as RecentWhatsAppWebhookEvent[];
    },
    enabled: !!workspaceId,
    refetchInterval: 60_000,
  });
}
