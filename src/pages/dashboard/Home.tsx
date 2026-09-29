import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome to StabiFlow</h1>
        <p className="text-sm text-muted-foreground">Give us your website, check what we find, and get a professional company profile.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" /> {name}
            </CardTitle>
            <CardDescription>
              {completeness ? `Your business profile is ${completeness.score}% complete.` : "Loading your business details..."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/app/business">
                Review my business <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4" /> Plans
            </CardTitle>
            <CardDescription>Buy a once-off professional profile, or subscribe to keep it current and hosted.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/app/billing">See plans</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
