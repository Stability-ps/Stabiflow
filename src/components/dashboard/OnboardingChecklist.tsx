import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, ChevronDown, Circle, X } from "lucide-react";
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

  const toggle = (
    <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-controls="onboarding-steps">
      {expanded ? "Show less" : nearlyComplete ? "View remaining" : "View all steps"}
      <ChevronDown className={cn("transition-transform duration-fast", expanded && "rotate-180")} aria-hidden="true" />
    </Button>
  );
  const dismiss = (
    <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" onClick={handleDismiss} aria-label="Dismiss setup checklist">
      <X aria-hidden="true" />
    </Button>
  );

  return (
    <section aria-labelledby="onboarding-title" className="rounded-xl border border-border bg-card">
      {/* Header wraps on narrow phones so the dismiss control never clips. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 id="onboarding-title" className="text-title-card text-foreground">Finish setting up StabiFlow</h2>
            <p className="text-sm text-muted-foreground">{completed} of {total} complete · {total - completed} remaining</p>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={completed}
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {toggle}
          {dismiss}
        </div>
      </div>
      {(visibleNextSteps.length > 0 || (nearlyComplete && !expanded) || expanded) && (
        <div id="onboarding-steps" className="space-y-3 border-t border-border px-4 py-3">
          {visibleNextSteps.length > 0 && <div className="grid gap-2 md:grid-cols-3">
            {visibleNextSteps.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.to)}
                className="group flex min-h-[4.5rem] items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors duration-fast hover:border-input hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-fast group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>}
          {nearlyComplete && !expanded && <p className="text-xs text-muted-foreground">Almost there — open the remaining steps when you are ready to finish setup.</p>}
          {expanded && (
            <ul className="divide-y divide-border rounded-lg border border-border px-3">
              {items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => !item.complete && navigate(item.to)}
                    disabled={item.complete}
                    className={cn(
                      "flex w-full items-start gap-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      !item.complete && "-mx-1 cursor-pointer rounded-md px-1 hover:bg-accent/60",
                    )}
                  >
                    {item.complete ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-solid" aria-label="Done" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-medium text-foreground", item.complete && "text-muted-foreground line-through")}>{item.label}</p>
                      {!item.complete && <p className="text-xs text-muted-foreground">{item.description}</p>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
