import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, ChevronDown, Circle, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { computeOnboardingItems, onboardingProgress } from "@/lib/onboarding";

function dismissedKey(workspaceId: string) {
  return `onboarding-dismissed-${workspaceId}`;
}

// A dismissible progress card, never a gate - every item is a shortcut to
// somewhere already fully usable on its own. Completion is read from real
// persisted state (see useOnboardingStatus), not a client-only flag, so it
// stays honest across devices/sessions and after a hard refresh.
export function OnboardingChecklist({ workspaceId }: { workspaceId: string | null }) {
  const navigate = useNavigate();
  const statusQuery = useOnboardingStatus(workspaceId);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    if (!workspaceId) return false;
    try {
      return localStorage.getItem(dismissedKey(workspaceId)) === "1";
    } catch {
      return false;
    }
  });

  if (!workspaceId || dismissed || !statusQuery.data) return null;

  const items = computeOnboardingItems(statusQuery.data);
  const { completed, total } = onboardingProgress(items);
  if (completed === total) return null; // fully done - no reason to keep showing it

  const percent = Math.round((completed / total) * 100);
  const remaining = items.filter((item) => !item.complete);
  const nearlyComplete = remaining.length <= 3;
  const visibleNextSteps = nearlyComplete && !expanded ? [] : remaining.slice(0, 3);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissedKey(workspaceId), "1");
    } catch {
      // best-effort only
    }
  };

  return (
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 bg-muted/20 pb-3 pt-4">
        <div>
          <CardTitle className="text-lg">Finish setting up StabiFlow</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{completed} of {total} complete · {total - completed} remaining</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Show less" : nearlyComplete ? "View remaining" : "View all steps"}
            <ChevronDown className={cn("ml-2 h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleDismiss} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-4 pt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        {visibleNextSteps.length > 0 && <div className="grid gap-2 md:grid-cols-3">
          {visibleNextSteps.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.to)}
              className="group flex min-h-20 items-start gap-3 rounded-xl border bg-background p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
            >
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
              </div>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </button>
          ))}
        </div>}
        {nearlyComplete && !expanded && <p className="text-xs text-muted-foreground">Almost there — open the remaining steps when you are ready to finish setup.</p>}
        {expanded && (
          <ul className="divide-y rounded-xl border px-3">
            {items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => !item.complete && navigate(item.to)}
                  disabled={item.complete}
                  className={cn(
                    "flex w-full items-start gap-3 py-2.5 text-left",
                    !item.complete && "cursor-pointer hover:bg-muted/50 rounded-md px-1 -mx-1",
                  )}
                >
                  {item.complete ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-medium", item.complete && "text-muted-foreground line-through")}>{item.label}</p>
                    {!item.complete && <p className="text-xs text-muted-foreground">{item.description}</p>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
