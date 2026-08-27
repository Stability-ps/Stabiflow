import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useFlowAiConversations, useFlowAiMessages, useSendFlowAiMessage } from "@/hooks/useFlowAiChat";

// Flow AI (Phase I, V1) - a read-only workspace intelligence assistant.
// It can inspect authorized workspace data and answer questions/suggest
// actions in its own words; it has NO ability to change anything - see
// supabase/functions/_shared/flowAi/systemPrompt.ts for the exact boundary
// stated to the model itself.
export default function FlowAI() {
  const { currentWorkspaceId, hasPermission } = useAuth();
  const canUse = hasPermission("flow_ai.use");

  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversationsQuery = useFlowAiConversations(canUse ? currentWorkspaceId : null);
  const messagesQuery = useFlowAiMessages(selectedConversationId);
  const { send, streamingText, isStreaming, error } = useSendFlowAiMessage(currentWorkspaceId);

  // A workspace switch must never keep a previous workspace's conversation
  // selected - even though RLS already makes it unreadable, the UI state
  // itself is reset so there's no stale "selected thread" pointing at data
  // that no longer belongs to the active workspace.
  useEffect(() => {
    setSelectedConversationId(null);
  }, [currentWorkspaceId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messagesQuery.data, streamingText]);

  if (!canUse) {
    return <EmptyState icon={Sparkles} title="Flow AI" description="You don't have permission to use Flow AI in this workspace. Ask a workspace owner or admin." />;
  }

  const handleSend = async () => {
    const message = draft.trim();
    if (!message || isStreaming) return;
    setDraft("");
    const resolvedId = await send(selectedConversationId, message);
    if (resolvedId && resolvedId !== selectedConversationId) setSelectedConversationId(resolvedId);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <aside className="w-64 shrink-0 space-y-2 overflow-y-auto border-r pr-3">
        <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => setSelectedConversationId(null)}>
          <Plus className="h-4 w-4" /> New conversation
        </Button>
        <div className="space-y-1">
          {(conversationsQuery.data ?? []).map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedConversationId(c.id)}
              className={cn(
                "w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                c.id === selectedConversationId && "bg-muted font-medium",
              )}
            >
              {c.title}
            </button>
          ))}
          {conversationsQuery.data?.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No conversations yet.</p>}
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
          {!selectedConversationId && (messagesQuery.data ?? []).length === 0 && !streamingText && (
            <EmptyState
              icon={Sparkles}
              title="Ask Flow AI about your workspace"
              description="Try: “How did our campaigns perform this month?”, “Summarize our open opportunities”, or “What's our WhatsApp conversion rate?” Flow AI can only read and recommend - it never changes anything."
            />
          )}
          {(messagesQuery.data ?? [])
            .filter((m) => m.role === "user" || m.role === "assistant")
            .filter((m) => m.content)
            .map((m) => (
              <div key={m.id} className={cn("max-w-2xl rounded-lg px-4 py-2 text-sm", m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted")}>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ))}
          {isStreaming && streamingText && (
            <div className="max-w-2xl rounded-lg bg-muted px-4 py-2 text-sm">
              <p className="whitespace-pre-wrap">{streamingText}</p>
            </div>
          )}
          {isStreaming && !streamingText && <p className="text-sm text-muted-foreground">Flow AI is thinking…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex items-end gap-2 border-t pt-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask Flow AI about campaigns, leads, revenue, WhatsApp performance..."
            className="min-h-[44px] flex-1 resize-none"
            disabled={isStreaming}
          />
          <Button onClick={() => void handleSend()} disabled={isStreaming || !draft.trim()} size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
