// Agent assist: drafts and insights for the human handling a chat. Results
// only ever land in the composer or a dismissible panel - sending is always
// the agent's own click on Send.
import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { requestAgentAssist, type AssistMode } from "@/lib/inbox";

const DRAFT_MODES: { mode: AssistMode; label: string; needsDraft?: boolean }[] = [
  { mode: "suggest_reply", label: "Suggest a reply" },
  { mode: "follow_up", label: "Draft a follow-up" },
  { mode: "improve", label: "Improve my reply", needsDraft: true },
  { mode: "shorten", label: "Shorten", needsDraft: true },
  { mode: "professional", label: "Make professional", needsDraft: true },
];
const INSIGHT_MODES: { mode: AssistMode; label: string }[] = [
  { mode: "summarise", label: "Summarise conversation" },
  { mode: "next_action", label: "Suggest next action" },
  { mode: "intent", label: "Identify customer intent" },
];

export function AgentAssistMenu({ workspaceId, conversationId, draft, onDraft, disabled }: {
  workspaceId: string; conversationId: string; draft: string; onDraft: (text: string) => void; disabled?: boolean;
}) {
  const [busy, setBusy] = useState<AssistMode | null>(null);
  const [insight, setInsight] = useState<{ title: string; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const run = async (mode: AssistMode, title: string) => {
    setBusy(mode);
    try {
      const res = await requestAgentAssist(workspaceId, conversationId, mode, draft);
      if (res.kind === "reply") {
        onDraft(res.text);
        setWarnings(res.warnings);
        toast.success("Draft added to your reply. Review it before sending.");
      } else {
        setInsight({ title, text: res.text });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Agent assist is unavailable right now");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {insight ? (
        <div className="relative rounded-md border bg-muted/40 p-2 pr-8 text-xs" role="status">
          <p className="mb-1 font-medium">{insight.title} <span className="font-normal text-muted-foreground">· only visible to your team</span></p>
          <p className="whitespace-pre-wrap">{insight.text}</p>
          <button type="button" className="absolute right-2 top-2 text-muted-foreground hover:text-foreground" aria-label="Dismiss" onClick={() => setInsight(null)}><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}
      {warnings.length ? (
        <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">{warnings.map((w) => <li key={w}>• {w}</li>)}</ul>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={disabled || busy !== null}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}AI assist
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-xs">Draft (you review before sending)</DropdownMenuLabel>
          {DRAFT_MODES.map((m) => (
            <DropdownMenuItem key={m.mode} disabled={m.needsDraft && !draft.trim()} onSelect={() => void run(m.mode, m.label)}>
              {m.label}{m.needsDraft && !draft.trim() ? <span className="ml-auto text-[10px] text-muted-foreground">write first</span> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs">For you only</DropdownMenuLabel>
          {INSIGHT_MODES.map((m) => <DropdownMenuItem key={m.mode} onSelect={() => void run(m.mode, m.label)}>{m.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
