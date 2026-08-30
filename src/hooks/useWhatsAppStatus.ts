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
