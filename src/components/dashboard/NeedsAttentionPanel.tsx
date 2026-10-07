import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import { useAuth } from "@/hooks/useAuth";
import { useNeedsAttention } from "@/hooks/useNeedsAttention";
import { relativeTimeShort, summarize, type NeedsAttentionItem } from "@/lib/needsAttention";
import { cn } from "@/lib/utils";

// Navigation state each item carries so its link lands on the right record
// - reuses the exact state keys the Inbox / Leads pages already honour.
function linkFor(item: NeedsAttentionItem): { to: string; state?: unknown } {
  switch (item.targetType) {
    case "conversation":
      return { to: item.actionPath, state: { selectedId: item.targetId } };
    case "lead":
      return { to: item.actionPath, state: { selectedLeadId: item.targetId } };
    default:
      return { to: item.actionPath };
  }
}

const SEVERITY_TONE = { critical: "danger", warning: "warning", info: "info" } as const;

export function NeedsAttentionPanel({ workspaceId, limit = 6 }: { workspaceId: string | null; limit?: number }) {
  const { currentMembership } = useAuth();
  const { items, isLoading, partialFailure } = useNeedsAttention(workspaceId);

  // A member with no role gets an empty list from the hook (every source
  // query is permission-gated) - render nothing rather than an empty card.
  if (!currentMembership?.role) return null;

  return (
    <Panel aria-labelledby="needs-attention-title">
      <PanelHeader
        titleId="needs-attention-title"
        title="Needs attention"
        action={items.length > 0 ? <span className="text-xs text-muted-foreground">{summarize(items)}</span> : undefined}
      />
      {isLoading ? (
        <div className="space-y-3 p-4" role="status" aria-label="Loading">
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          <div className="h-10 animate-pulse rounded-md bg-muted" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success-solid" aria-hidden="true" />
          {partialFailure ? "Some sources couldn't be checked right now — nothing else needs your attention." : "Nothing needs your attention right now."}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {items.slice(0, limit).map((item) => {
              const link = linkFor(item);
              return (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <AlertTriangle
                    className={cn("mt-0.5 h-4 w-4 shrink-0", item.severity === "critical" ? "text-destructive" : item.severity === "warning" ? "text-warning-solid" : "text-info-solid")}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="text-sm text-muted-foreground sm:truncate">{item.description}</p>
                    {item.occurredAt && <p className="mt-0.5 text-xs text-muted-foreground">{relativeTimeShort(item.occurredAt)}</p>}
                  </div>
                  <StatusPill tone={SEVERITY_TONE[item.severity]} className="mt-0.5 hidden capitalize sm:inline-flex">{item.severity}</StatusPill>
                  <span className="sr-only sm:hidden">Severity: {item.severity}</span>
                  <Link
                    to={link.to}
                    state={link.state}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded text-sm font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:pt-0.5"
                    aria-label={`${item.canAct ? item.actionLabel : "View"}: ${item.title}`}
                  >
                    {item.canAct ? item.actionLabel : "View"} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {items.length > limit && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">+{items.length - limit} more</p>}
          {partialFailure && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">Some sources couldn&apos;t be checked; this list may be incomplete.</p>}
        </>
      )}
    </Panel>
  );
}
