import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Sparkles, Send, Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    return <EmptyState icon={Sparkles} title="Flow AI" description="You don't have permission to use Flow AI in this workspace. Ask a workspace owner or admin." className="rounded-xl border border-border bg-card" />;
  }

  const sendMessage = async (message: string) => {
    if (!message || isStreaming) return;
    setDraft("");
    const resolvedId = await send(selectedConversationId, message);
    if (resolvedId && resolvedId !== selectedConversationId) setSelectedConversationId(resolvedId);
  };

  const handleSend = () => sendMessage(draft.trim());
  const handleStarterPrompt = (prompt: string) => sendMessage(prompt);

  const conversations = conversationsQuery.data ?? [];
  const visibleMessages = (messagesQuery.data ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && m.content);

  return (
    // Fills the viewport under the header (and above the phone bottom nav)
    // so the composer stays in reach and only the thread scrolls.
    <div className="mx-auto flex h-[calc(100dvh-var(--header-height)-var(--bottom-nav-height)-env(safe-area-inset-top)-2rem)] min-h-[24rem] w-full max-w-[1440px] flex-col gap-3 md:h-[calc(100dvh-var(--header-height)-3rem)]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-title-page text-foreground"><Sparkles className="h-5 w-5 text-brand" aria-hidden="true" /> Flow AI</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">Ask about your workspace. Flow AI reads your data and recommends next steps - it never changes anything on its own.</p>
        </div>
        {/* Phones/tablets: conversations live in a picker; the sidebar is md+ only. */}
        <div className="flex w-full items-center gap-2 md:hidden">
          <Select value={selectedConversationId ?? "new"} onValueChange={(v) => setSelectedConversationId(v === "new" ? null : v)}>
            <SelectTrigger className="min-w-0 flex-1" aria-label="Conversation"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New conversation</SelectItem>
              {conversations.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" aria-label="New conversation" onClick={() => setSelectedConversationId(null)}><Plus aria-hidden="true" /></Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        <aside aria-label="Conversations" className="hidden w-64 shrink-0 flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-card p-2 md:flex">
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setSelectedConversationId(null)}>
            <Plus aria-hidden="true" /> New conversation
          </Button>
          {conversationsQuery.isError ? (
            <div role="alert" className="space-y-2 px-2 py-1.5 text-xs text-destructive-strong">
              <p className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Couldn't load conversations.</p>
              <Button variant="outline" size="sm" onClick={() => void conversationsQuery.refetch()}>Try again</Button>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedConversationId(c.id)}
                    aria-current={c.id === selectedConversationId ? "true" : undefined}
                    className={cn(
                      "w-full truncate rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      c.id === selectedConversationId && "bg-selected font-medium",
                    )}
                  >
                    {c.title}
                  </button>
                </li>
              ))}
              {conversationsQuery.data?.length === 0 && <li className="px-3 py-1.5 text-xs text-muted-foreground">No conversations yet.</li>}
            </ul>
          )}
        </aside>

        <section aria-label="Chat" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4" aria-live="polite">
            {selectedConversationId && messagesQuery.isError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive-strong">
                <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Couldn't load this conversation.</span>
                <Button variant="outline" size="sm" className="bg-card" onClick={() => void messagesQuery.refetch()}>Try again</Button>
              </div>
            )}
            {!selectedConversationId && visibleMessages.length === 0 && !streamingText && (
              <div className="space-y-4">
                <EmptyState
                  icon={Sparkles}
                  title="Ask Flow AI about your workspace"
                  description="Flow AI can analyze your workspace data and recommend what to do next - it never changes anything on its own."
                />
                <div className="flex flex-wrap justify-center gap-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <Button key={prompt} variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal py-1.5 text-left" disabled={isStreaming} onClick={() => void handleStarterPrompt(prompt)}>
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {visibleMessages.map((m) => (
              <div key={m.id} className={cn("max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm sm:max-w-2xl", m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            ))}
            {isStreaming && streamingText && (
              <div className="max-w-[85%] rounded-xl bg-muted px-3.5 py-2.5 text-sm text-foreground sm:max-w-2xl">
                <p className="whitespace-pre-wrap break-words">{streamingText}</p>
              </div>
            )}
            {isStreaming && !streamingText && <p className="text-sm text-muted-foreground" role="status">Flow AI is thinking…</p>}
            {error && <p role="alert" className="text-sm text-destructive-strong">{error}</p>}
          </div>

          <div className="flex items-end gap-2 border-t border-border p-2 sm:p-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              aria-label="Message Flow AI"
              placeholder="Ask about campaigns, leads, revenue, WhatsApp..."
              className="min-h-[44px] flex-1 resize-none"
              disabled={isStreaming}
            />
            <Button onClick={() => void handleSend()} disabled={isStreaming || !draft.trim()} size="icon" aria-label="Send">
              <Send aria-hidden="true" />
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
