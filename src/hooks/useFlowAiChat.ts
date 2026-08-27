import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export type FlowAiConversation = { id: string; title: string; created_at: string; updated_at: string };
export type FlowAiMessage = { id: string; role: "user" | "assistant" | "tool"; content: string | null; tool_name: string | null; created_at: string };

/** flow-ai-chat's conversation list for the current workspace - private per creator (RLS), so this never shows another member's threads. */
export function useFlowAiConversations(workspaceId: string | null) {
  return useQuery({
    queryKey: ["flow-ai-conversations", workspaceId],
    queryFn: async (): Promise<FlowAiConversation[]> => {
      const { data, error } = await supabase
        .from("ai_conversations")
        .select("id, title, created_at, updated_at")
        .eq("workspace_id", workspaceId as string)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!workspaceId,
  });
}

export function useFlowAiMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ["flow-ai-messages", conversationId],
    queryFn: async (): Promise<FlowAiMessage[]> => {
      const { data, error } = await supabase
        .from("ai_messages")
        .select("id, role, content, tool_name, created_at")
        .eq("conversation_id", conversationId as string)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as FlowAiMessage[];
    },
    enabled: !!conversationId,
  });
}

/**
 * Streams a message to the flow-ai-chat edge function via raw fetch (SSE) -
 * supabase-js's .functions.invoke() doesn't support streaming responses.
 * The edge function is the sole writer of ai_messages; once the stream
 * ends, this just invalidates the relevant queries so the UI reflects the
 * canonical persisted rows rather than maintaining a second copy of the
 * conversation's truth client-side.
 */
export function useSendFlowAiMessage(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (conversationId: string | null, message: string): Promise<string | null> => {
      setError(null);
      setIsStreaming(true);
      setStreamingText("");
      let resolvedConversationId = conversationId;

      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Not signed in");

        const res = await fetch(`${SUPABASE_URL}/functions/v1/flow-ai-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(conversationId ? { conversationId, message } : { workspaceId, message }),
        });

        if (!res.ok || !res.body) {
          const problem = await res.json().catch(() => ({}) as { error?: string });
          throw new Error(problem.error || `Flow AI request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            if (dataLine) {
              const event = JSON.parse(dataLine.slice(5).trim());
              if (event.type === "conversation_id") resolvedConversationId = event.id;
              else if (event.type === "text_delta") setStreamingText((prev) => prev + event.text);
              else if (event.type === "error") setError(event.message);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setIsStreaming(false);
        setStreamingText("");
        if (resolvedConversationId) queryClient.invalidateQueries({ queryKey: ["flow-ai-messages", resolvedConversationId] });
        queryClient.invalidateQueries({ queryKey: ["flow-ai-conversations", workspaceId] });
      }

      return resolvedConversationId;
    },
    [workspaceId, queryClient],
  );

  return { send, streamingText, isStreaming, error };
}
