import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useAutomationRuns, useAutomationRunSteps, type AutomationRow } from "@/hooks/useAutomations";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  succeeded: "default",
  partial: "secondary",
  failed: "destructive",
  blocked_permission: "destructive",
  skipped_conditions_not_met: "outline",
  pending: "secondary",
  in_progress: "secondary",
};

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

export function AutomationRunsSheet({ workspaceId, automation }: { workspaceId: string; automation: AutomationRow }) {
  const { data: runs, isLoading } = useAutomationRuns(workspaceId, automation.id);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  return (
    <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
      <SheetHeader>
        <SheetTitle>{automation.name} - run history</SheetTitle>
        <SheetDescription>The last 50 times this automation matched a trigger event, most recent first.</SheetDescription>
      </SheetHeader>

      <div className="mt-4 space-y-2">
        {isLoading && <div className="h-24 animate-pulse rounded-lg bg-muted" />}
        {!isLoading && (runs || []).length === 0 && (
          <p className="text-sm text-muted-foreground">No runs yet - this automation hasn't matched a trigger event.</p>
        )}
        {(runs || []).map((run) => (
          <div key={run.id} className="rounded-lg border">
            <button type="button" className="flex w-full items-center justify-between p-3 text-left" onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}>
              <div>
                <Badge variant={STATUS_VARIANT[run.status] || "outline"}>{formatStatus(run.status)}</Badge>
                <span className="ml-2 text-xs text-muted-foreground">{new Date(run.created_at).toLocaleString()}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {run.status === "pending" && run.next_retry_at ? `Retrying at ${new Date(run.next_retry_at).toLocaleTimeString()}` : `Attempt ${run.attempt_count}`}
              </span>
            </button>
            {run.error && <p className="border-t px-3 py-2 text-xs text-destructive">{(run.error as { message?: string }).message || JSON.stringify(run.error)}</p>}
            {expandedRunId === run.id && <RunSteps workspaceId={workspaceId} runId={run.id} />}
          </div>
        ))}
      </div>
    </SheetContent>
  );
}

function RunSteps({ workspaceId, runId }: { workspaceId: string; runId: string }) {
  const { data: steps, isLoading } = useAutomationRunSteps(workspaceId, runId);
  if (isLoading) return <div className="border-t p-3"><div className="h-10 animate-pulse rounded bg-muted" /></div>;
  return (
    <div className="space-y-1.5 border-t p-3">
      {(steps || []).map((step) => (
        <div key={step.id} className="flex items-center justify-between text-xs">
          <span>{step.action_type.replace(/_/g, " ")}</span>
          <Badge variant={STATUS_VARIANT[step.status] || "outline"} className="text-[10px]">{formatStatus(step.status)}</Badge>
        </div>
      ))}
      {(steps || []).length === 0 && <p className="text-xs text-muted-foreground">No steps recorded (conditions weren't met, or the run hasn't started yet).</p>}
    </div>
  );
}
