import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import type { LeadRow, PipelineStage } from "@/hooks/useLeads";
import { followUpLabel, followUpState, type FollowUpState } from "@/lib/leadsWorkspace";

const FOLLOW_UP_TONE: Record<FollowUpState["kind"], StatusTone> = { overdue: "danger", due_today: "warning", upcoming: "info", none: "neutral" };

/** Follow-up state as a pill. The visible text carries the meaning; the tone only reinforces it. */
export function FollowUpPill({ lead, now, className }: { lead: Pick<LeadRow, "status" | "archived_at" | "next_follow_up_at">; now: Date; className?: string }) {
  const state = followUpState(lead, now);
  return (
    <StatusPill tone={FOLLOW_UP_TONE[state.kind]} className={className} title={state.kind === "none" ? undefined : state.at.toLocaleString()}>
      {state.kind === "upcoming" ? `Follow up ${followUpLabel(state)}` : followUpLabel(state)}
    </StatusPill>
  );
}

/** Where the lead is: closed leads say Converted / Lost; open ones show their pipeline stage. */
export function StagePill({ lead, stage, className }: { lead: Pick<LeadRow, "status">; stage: PipelineStage | undefined; className?: string }) {
  if (lead.status === "converted") return <StatusPill tone="success" dot={false} className={className}>Converted</StatusPill>;
  if (lead.status === "lost") return <StatusPill tone="neutral" dot={false} className={className}>Lost</StatusPill>;
  if (!stage) return <StatusPill tone="neutral" dot={false} className={className}>No stage</StatusPill>;
  const tone: StatusTone = stage.is_won_stage ? "success" : stage.is_lost_stage ? "neutral" : "info";
  return <StatusPill tone={tone} dot={false} className={className}>{stage.name}</StatusPill>;
}
