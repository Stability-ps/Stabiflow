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

// Each prompt maps cleanly to a real tool in
// supabase/functions/_shared/flowAi/tools.ts (get_campaign_performance,
// get_lead_source_breakdown, get_analytics_kpis, get_whatsapp_analytics,
// list_opportunities) - never advertise a capability Flow AI doesn't have.
const STARTER_PROMPTS = [
  "How are my campaigns performing?",
  "Which leads need attention?",
  "What's my WhatsApp conversion rate?",
  "Summarize my open opportunities",
  "What should I focus on today?",
];

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

  const sendMessage = async (message: string) => {
    if (!message || isStreaming) return;
    setDraft("");
    const resolvedId = await send(selectedConversationId, message);
    if (resolvedId && resolvedId !== selectedConversationId) setSelectedConversationId(resolvedId);
  };

  const handleSend = () => sendMessage(draft.trim());
  const handleStarterPrompt = (prompt: string) => sendMessage(prompt);

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] w-full max-w-[1500px] gap-4 overflow-hidden rounded-3xl border border-violet-100/80 bg-card/85 p-3 shadow-[0_18px_60px_-42px_hsl(260_60%_40%/0.28)] backdrop-blur-sm sm:p-4 dark:border-border">
      <aside className="w-64 shrink-0 space-y-2 overflow-y-auto rounded-2xl border border-border/60 bg-muted/20 p-3">
        <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => setSelectedConversationId(null)}>
          <Plus className="h-4 w-4" /> New conversation
        </Button>
        <div className="space-y-1">
          {(conversationsQuery.data ?? []).map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedConversationId(c.id)}
              className={cn(
                "w-full truncate rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-background",
                c.id === selectedConversationId && "bg-background font-medium shadow-sm",
              )}
            >
              {c.title}
            </button>
          ))}
          {conversationsQuery.data?.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No conversations yet.</p>}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col rounded-2xl bg-background/55 p-2 sm:p-4">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
          {!selectedConversationId && (messagesQuery.data ?? []).length === 0 && !streamingText && (
            <div className="space-y-4">
              <EmptyState
                icon={Sparkles}
                title="Ask Flow AI about your workspace"
                description="Flow AI can analyze your workspace data and recommend what to do next - it never changes anything on its own."
              />
              <div className="flex flex-wrap justify-center gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <Button key={prompt} variant="outline" size="sm" disabled={isStreaming} onClick={() => void handleStarterPrompt(prompt)}>
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {(messagesQuery.data ?? [])
            .filter((m) => m.role === "user" || m.role === "assistant")
            .filter((m) => m.content)
            .map((m) => (
              <div key={m.id} className={cn("max-w-2xl rounded-2xl px-4 py-3 text-sm shadow-sm", m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted")}>
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

        <div className="flex items-end gap-2 rounded-2xl border border-border/70 bg-card/90 p-2 shadow-sm">
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
