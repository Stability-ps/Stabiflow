import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/billing";
import { operatorAdmin, type AdminOverview } from "@/lib/operatorAdmin";

function Stat({ label, value, hint, warn }: { label: string; value: string | number; hint?: string; warn?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-semibold ${warn ? "text-destructive" : ""}`}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function OperatorOverview() {
  const q = useQuery({ queryKey: ["operator-overview"], queryFn: () => operatorAdmin<AdminOverview>("overview") });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (q.error || !q.data) return <p className="text-sm text-destructive">Could not load overview.</p>;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Workspaces" value={d.workspaces} hint={`${d.newWorkspaces30d} new in 30 days`} />
        <Stat label="Users" value={d.users} />
        <Stat label="MRR (estimate)" value={formatMoney(d.mrrMinor, d.currency)} hint={`${d.subscriptions.total} live subscriptions`} />
        <Stat label="Revenue, last 30 days" value={formatMoney(d.revenue30dMinor, d.currency)} />
        <Stat label="Past due / in grace" value={d.subscriptions.pastDueOrGrace} warn={d.subscriptions.pastDueOrGrace > 0} />
        <Stat label="Failed payment webhooks (7d)" value={d.billingAlerts.failedWebhooks7d} warn={d.billingAlerts.failedWebhooks7d > 0} />
        <Stat label="Payments needing review" value={d.billingAlerts.amountMismatches} hint="Amount did not match" warn={d.billingAlerts.amountMismatches > 0} />
        <Stat label="Unfinished checkouts" value={d.billingAlerts.pendingCheckouts} />
        <Stat label="AI cost, last 30 days" value={`$${d.ai30d.costUsd.toFixed(2)}`} hint={`${d.ai30d.tokens.toLocaleString()} tokens`} />
        <Stat label="Failed automations (7d)" value={d.failures7d.automations} warn={d.failures7d.automations > 0} />
        <Stat label="Failed content posts (7d)" value={d.failures7d.contentPosts} warn={d.failures7d.contentPosts > 0} />
        <Stat label="Business profiles with a website" value={d.businessProfilesWithWebsite} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subscriptions by plan</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {Object.keys(d.subscriptions.byPlan).length === 0 && <p className="text-muted-foreground">No subscriptions yet.</p>}
          {Object.entries(d.subscriptions.byPlan).map(([code, p]) => (
            <p key={code}>
              {p.name}: <span className="font-medium">{p.count}</span>
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
