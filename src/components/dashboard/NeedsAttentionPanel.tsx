import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useNeedsAttention } from "@/hooks/useNeedsAttention";
import { relativeTimeShort, severityTone, summarize, type NeedsAttentionItem } from "@/lib/needsAttention";

// Navigation state each item type carries so its "Open" link lands on the
// right record - reuses the exact state keys the Inbox / Leads pages
// already honour (WhatsApp Inbox: { selectedId }; Leads: { selectedLeadId }).
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

export function NeedsAttentionPanel({ workspaceId, limit = 6 }: { workspaceId: string | null; limit?: number }) {
  const { currentMembership } = useAuth();
  const { data: items, isLoading, isError } = useNeedsAttention(workspaceId);

  // A member with no relevant permissions gets an empty list from the hook
  // (RLS returns nothing) - render nothing rather than an empty card.
  const role = currentMembership?.role;
  const hasAnyRelevantPermission = !!role; // the hook itself filters by permission per source

  if (!hasAnyRelevantPermission) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base">Needs attention</CardTitle>
        {items && items.length > 0 && (
          <span className="text-xs text-muted-foreground">{summarize(items)}</span>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-20 animate-pulse rounded-lg bg-muted" />
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load this right now. It&apos;ll refresh automatically.</p>
        ) : !items || items.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Nothing needs your attention right now.
          </div>
        ) : (
          <ul className="divide-y">
            {items.slice(0, limit).map((item) => {
              const link = linkFor(item);
              return (
                <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-start gap-2">
                    <AlertTriangle
                      className={`mt-0.5 h-4 w-4 shrink-0 ${item.severity === "critical" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{item.title}</span>
                        <Badge variant="secondary" className={`text-[10px] ${severityTone(item.severity)}`}>{item.severity}</Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                      <p className="text-[11px] text-muted-foreground">{relativeTimeShort(item.occurredAt)}</p>
                    </div>
                  </div>
                  <Link
                    to={link.to}
                    state={link.state}
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                    aria-label={`${item.actionLabel}: ${item.title}`}
                  >
                    {item.actionLabel} <ArrowRight className="h-3 w-3" />
                  </Link>
                </li>
              );
            })}
            {items.length > limit && (
              <li className="pt-2 text-xs text-muted-foreground">+{items.length - limit} more</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
