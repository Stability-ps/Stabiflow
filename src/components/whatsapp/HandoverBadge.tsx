import { Bot, CheckCircle2, Hand, PauseCircle, UserRound, type LucideIcon } from "lucide-react";
import { HANDOVER_LABELS, handoverState, type HandoverInput, type HandoverState } from "@/lib/handoverState";
import { cn } from "@/lib/utils";

const STYLE: Record<HandoverState, { icon: LucideIcon; className: string }> = {
  bot_active: { icon: Bot, className: "bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300" },
  handover_requested: { icon: Hand, className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" },
  human_active: { icon: UserRound, className: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" },
  bot_paused: { icon: PauseCircle, className: "bg-muted text-muted-foreground" },
  closed: { icon: CheckCircle2, className: "bg-muted text-muted-foreground" },
};

/** Who is handling this conversation right now. Icon + text, never colour alone. */
export function HandoverBadge({ conversation, assigneeName, className }: { conversation: HandoverInput; assigneeName?: string | null; className?: string }) {
  const state = handoverState(conversation);
  const s = STYLE[state];
  const label = state === "human_active" && assigneeName ? assigneeName.split(" ")[0] : HANDOVER_LABELS[state].label;
  return (
    <span title={HANDOVER_LABELS[state].description} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", s.className, className)}>
      <s.icon className="h-3 w-3" aria-hidden="true" />{label}
    </span>
  );
}
