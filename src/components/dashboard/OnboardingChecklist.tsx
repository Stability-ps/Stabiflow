import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronDown, ChevronUp, Circle, X } from "lucide-react";
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
  const [expanded, setExpanded] = useState(true);
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

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissedKey(workspaceId), "1");
    } catch {
      // best-effort only
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Get set up ({completed}/{total})</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">A few steps to get the most out of StabiFlow - skip anything, come back anytime.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? "Collapse" : "Expand"}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={handleDismiss} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        {expanded && (
          <ul className="divide-y">
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
