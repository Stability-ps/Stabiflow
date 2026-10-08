import { Bot, CheckCircle2, Hand, PauseCircle, UserRound, type LucideIcon } from "lucide-react";
import { HANDOVER_LABELS, handoverState, type HandoverInput, type HandoverState } from "@/lib/handoverState";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";

const STYLE: Record<HandoverState, { icon: LucideIcon; tone: StatusTone }> = {
  bot_active: { icon: Bot, tone: "brand" },
  handover_requested: { icon: Hand, tone: "warning" },
  human_active: { icon: UserRound, tone: "info" },
  bot_paused: { icon: PauseCircle, tone: "neutral" },
  closed: { icon: CheckCircle2, tone: "neutral" },
};

/** Who is handling this conversation right now. Icon + text, never colour alone. */
export function HandoverBadge({ conversation, assigneeName, className }: { conversation: HandoverInput; assigneeName?: string | null; className?: string }) {
  const state = handoverState(conversation);
  const s = STYLE[state];
  const label = state === "human_active" && assigneeName ? assigneeName.split(" ")[0] : HANDOVER_LABELS[state].label;
  return (
    <StatusPill tone={s.tone} dot={false} title={HANDOVER_LABELS[state].description} className={className}>
      <s.icon className="h-3 w-3" aria-hidden="true" />{label}
    </StatusPill>
  );
}
