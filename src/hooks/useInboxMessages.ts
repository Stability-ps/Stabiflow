import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type InboxMessageRow = {
  id: string;
  conversation_id: string;
  provider_message_id: string | null;
  direction: "inbound" | "outbound";
  sender_type: "customer" | "ai" | "staff" | "system";
  message_type: string;
  content: string | null;
  delivery_status: string | null;
  media_mime_type: string | null;
  media_filename: string | null;
  media_storage_path: string | null;
  staff_sender_name: string | null;
  created_at: string;
};

const MESSAGE_COLUMNS =
  "id, conversation_id, provider_message_id, direction, sender_type, message_type, content, delivery_status, media_mime_type, media_filename, media_storage_path, staff_sender_name, created_at";

export function useInboxMessages(conversationId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["inbox-messages", conversationId],
    queryFn: async (): Promise<InboxMessageRow[]> => {
      const { data, error } = await supabase.from("inbox_messages").select(MESSAGE_COLUMNS).eq("conversation_id", conversationId as string).order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data as InboxMessageRow[];
    },
    enabled: !!conversationId,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`inbox-messages-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "inbox_messages", filter: `conversation_id=eq.${conversationId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["inbox-messages", conversationId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);

  return query;
}

export function useInboxInternalNotes(conversationId: string | null) {
  return useQuery({
    queryKey: ["inbox-internal-notes", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("inbox_internal_notes").select("id, author_name, body, created_at").eq("conversation_id", conversationId as string).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!conversationId,
  });
}

export async function getInboxMediaUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("inbox-media").createSignedUrl(storagePath, 300);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
