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
    return (
      <EmptyState
        icon={Lock}
        title="Not available on your workspace yet"
        description="This part of StabiFlow isn't switched on for your workspace. Your data is safe - nothing has been removed."
        action={
          <Button asChild variant="outline">
            <Link to="/app">Back to home</Link>
          </Button>
        }
      />
    );
  }
  return <>{children}</>;
}
