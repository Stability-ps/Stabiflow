import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import type { FeatureFlagKey } from "@/lib/featureFlags";

/**
 * Route-level gate for a feature-flagged module. A direct link to a hidden
 * module shows a friendly "not available" state instead of the module -
 * nothing is deleted and the module comes back as soon as the flag is on.
 */
export function FeatureGate({ flag, children }: { flag: FeatureFlagKey; children: ReactNode }) {
  const { isEnabled, isLoading } = useFeatureFlags();
  if (isLoading) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isEnabled(flag)) {
    const isAutomations = flag === "module.automations";
    return (
      <EmptyState
        icon={Lock}
        title={isAutomations ? "Automations are a Growth feature" : "Not available on your workspace yet"}
        description={
          isAutomations
            ? "Automations are included with Growth and Pro workspaces. Upgrade to create, enable and run automated workflows. Existing automation data is kept safely if your plan changes."
            : "This part of StabiFlow isn't switched on for your workspace. Your data is safe - nothing has been removed."
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {isAutomations && (
              <Button asChild>
                <Link to="/app/billing">View plans</Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to="/app">Back to home</Link>
            </Button>
          </div>
        }
      />
    );
  }
  return <>{children}</>;
}
