import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3, DollarSign, MessageSquare, Sparkles, TrendingUp, Users, Wallet,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceActivity } from "@/hooks/useWorkspaceActivity";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";
import { useAnalyticsKpis } from "@/hooks/useAnalytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/layout/MetricCard";
import { EmptyState } from "@/components/EmptyState";
import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist";
import { computeRoas, formatMoneyByCurrency, formatRoas, summarizeCurrency } from "@/lib/analytics";
import { resolveDateRangePreset } from "@/lib/analyticsDate";

// Same authoritative analytics read model /analytics uses (get_analytics_kpis)
// - a fixed "last 30 days" window, since the homepage is a glance, not the
// full reporting surface. Never a second, independently-computed set of
// formulas that could quietly disagree with /analytics.
export default function Overview() {
  const navigate = useNavigate();
  const { currentMembership, currentWorkspaceId, hasPermission } = useAuth();
  const activityQuery = useWorkspaceActivity(currentWorkspaceId);
  const timezone = useWorkspaceTimezone(currentWorkspaceId);
  const canView = hasPermission("view_analytics");
  const canSeeRevenue = hasPermission("revenue.view");

  const [now] = useState(() => new Date());
  const range = useMemo(() => resolveDateRangePreset("last_30_days", timezone, now), [timezone, now]);
  const kpisQuery = useAnalyticsKpis(canView ? currentWorkspaceId : null, range);
  const kpis = kpisQuery.data;

  const spendTotal = kpis ? summarizeCurrency(kpis.spend) : null;
  const revenueTotal = kpis ? summarizeCurrency(kpis.revenue_attributed) : null;
  const roas = kpis && spendTotal?.kind === "single" ? computeRoas(spendTotal.amountMinor, spendTotal.currency, kpis.revenue_attributed) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {currentMembership ? `${currentMembership.workspace.name} - business overview` : "Business overview"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis ? (
          <>
            <MetricCard icon={Wallet} label="Campaign spend (30d)" emptyMessage="No campaign data yet" value={formatMoneyByCurrency(kpis.spend)} />
            <MetricCard icon={MessageSquare} label="Conversations (30d)" emptyMessage="No conversations yet" value={String(kpis.conversations)} />
            <MetricCard icon={Users} label="Qualified leads (30d)" emptyMessage="No leads yet" value={String(kpis.qualified_leads)} />
            <MetricCard icon={DollarSign} label="Customers (30d)" emptyMessage="No customers yet" value={String(kpis.customers)} />
            {canSeeRevenue && <MetricCard icon={TrendingUp} label="Revenue (30d)" emptyMessage="No revenue recorded yet" value={revenueTotal ? formatMoneyByCurrency(kpis.revenue_attributed) : undefined} />}
            {canSeeRevenue && <MetricCard icon={BarChart3} label="ROAS (30d)" emptyMessage="Not enough data yet" value={roas ? formatRoas(roas) : undefined} />}
          </>
        ) : (
          <>
            <MetricCard icon={Wallet} label="Campaign spend" emptyMessage={canView ? "Loading..." : "No campaign data yet"} />
            <MetricCard icon={MessageSquare} label="Conversations" emptyMessage="No conversations yet" />
            <MetricCard icon={Users} label="Qualified leads" emptyMessage="No leads yet" />
            <MetricCard icon={DollarSign} label="Customers" emptyMessage="No customers yet" />
            <MetricCard icon={TrendingUp} label="Revenue" emptyMessage="No revenue recorded yet" />
            <MetricCard icon={BarChart3} label="ROAS" emptyMessage="Not enough data yet" />
          </>
        )}
      </div>

      <OnboardingChecklist workspaceId={currentWorkspaceId} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Campaign performance</CardTitle></CardHeader>
          <CardContent>
            <EmptyState
              icon={BarChart3}
              title="No campaign data yet"
              description="Connect Meta and launch a campaign to see performance here."
              action={<Button size="sm" onClick={() => navigate("/campaigns/new")}>Create a campaign</Button>}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent conversations</CardTitle></CardHeader>
          <CardContent>
            <EmptyState
              icon={MessageSquare}
              title="No conversations yet"
              description="Connect WhatsApp to start receiving conversations here."
              action={<Button size="sm" onClick={() => navigate("/integrations")}>Connect WhatsApp</Button>}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Flow AI recommendations</CardTitle></CardHeader>
        <CardContent>
          <EmptyState
            icon={Sparkles}
            title="No recommendations yet"
            description="Flow AI needs campaign and conversion data before it can suggest anything - recommendations always require your approval before anything changes."
            action={<Button size="sm" variant="outline" onClick={() => navigate("/flow-ai")}>Try Flow AI</Button>}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
        <CardContent>
          {activityQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : activityQuery.isError ? (
            <p className="text-sm text-destructive">Unable to load recent activity.</p>
          ) : !activityQuery.data?.length ? (
            <EmptyState icon={TrendingUp} title="No activity yet" description="Actions taken in this workspace will show up here." />
          ) : (
            <ul className="space-y-2">
              {activityQuery.data.map((row) => (
                <li key={row.id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                  <span>{row.action.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
