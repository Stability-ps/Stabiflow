import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import Overview from "@/pages/dashboard/Overview";
import { useAuth } from "@/hooks/useAuth";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { computeCompleteness, fetchBusinessIdentity } from "@/lib/businessIdentity";

/**
 * /app. Workspaces with any advanced StabiFlow module switched on
 * (grandfathered workspaces, operators) keep the existing operational
 * Dashboard unchanged. Everyone else gets the focused Business Studio
 * launch home.
 */
export default function Home() {
  const { hasAdvancedModules, isLoading } = useFeatureFlags();
  if (isLoading) {
    // Layout-shaped skeleton (header + tiles) so Home doesn't jump on load.
    return (
      <div className="mx-auto w-full max-w-[1280px] space-y-4" role="status" aria-label="Loading">
        <div className="h-12 w-72 max-w-full animate-pulse rounded-lg bg-muted" />
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-[6.5rem] animate-pulse rounded-xl bg-muted" />)}
        </div>
      </div>
    );
  }
  return hasAdvancedModules ? <Overview /> : <BusinessHome />;
}

export function BusinessHome() {
  const { currentWorkspaceId, currentMembership } = useAuth();
  const identity = useQuery({
    queryKey: ["business-identity", currentWorkspaceId],
    queryFn: () => fetchBusinessIdentity(currentWorkspaceId as string),
    enabled: !!currentWorkspaceId,
  });
  const completeness = identity.data ? computeCompleteness(identity.data) : null;
  const name = identity.data?.identity.trading_name ?? currentMembership?.workspace?.name ?? "your business";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <header>
        <h1 className="text-title-page text-foreground">Welcome to StabiFlow</h1>
        <p className="mt-1 text-sm text-muted-foreground">Add your business details, preview a professional company profile, and upgrade when you are ready.</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <Panel aria-labelledby="home-business-title" className="flex flex-col">
          <PanelHeader titleId="home-business-title" title={<span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{name}</span>} />
          <div className="flex flex-1 flex-col gap-3 p-4">
            {completeness ? (
              <>
                <p className="text-sm text-muted-foreground">Your business profile is {completeness.score}% complete.</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Business profile completeness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completeness.score}>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${completeness.score}%` }} />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Loading your business details...</p>
            )}
            <Button asChild className="mt-auto self-start">
              <Link to="/app/business">
                Review my business <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </Panel>
        <Panel aria-labelledby="home-plans-title" className="flex flex-col">
          <PanelHeader titleId="home-plans-title" title={<span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Plans</span>} />
          <div className="flex flex-1 flex-col gap-3 p-4">
            <p className="text-sm text-muted-foreground">Buy a once-off professional profile, or subscribe to keep it current and hosted.</p>
            <Button asChild variant="outline" className="mt-auto self-start">
              <Link to="/app/billing">See plans</Link>
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
