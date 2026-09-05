import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3, DollarSign, MessageSquare, Sparkles, TrendingUp, Users, Wallet,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceActivity } from "@/hooks/useWorkspaceActivity";
import { useInboxConversations } from "@/hooks/useInboxConversations";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";
import { useAnalyticsKpis, useCampaignPerformance } from "@/hooks/useAnalytics";
import { useWorkspaceIntegrations } from "@/hooks/useIntegrations";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useWorkspaceCurrency } from "@/hooks/useWorkspaceCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/layout/MetricCard";
import { EmptyState } from "@/components/EmptyState";
import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist";
import { NeedsAttentionPanel } from "@/components/dashboard/NeedsAttentionPanel";
import { computeOnboardingItems, onboardingProgress } from "@/lib/onboarding";
import { computeRoas, DEFAULT_ATTRIBUTION_MODEL, formatMoneyByCurrency, formatRoas, summarizeCurrency } from "@/lib/analytics";
import { formatActivityAction, isDashboardActivity } from "@/lib/activityPresentation";
import { resolveDateRangePreset } from "@/lib/analyticsDate";
import { dashboardConversationValue, dashboardMoneyValue, hasCurrentIntegration } from "@/lib/dashboardPresentation";

// Same authoritative analytics read model /analytics uses (get_analytics_kpis)
// - a fixed "last 30 days" window, since the homepage is a glance, not the
// full reporting surface. Never a second, independently-computed set of
// formulas that could quietly disagree with /analytics.
export default function Overview() {
  const navigate = useNavigate();
  const { currentMembership, currentWorkspaceId, hasPermission } = useAuth();
  const activityQuery = useWorkspaceActivity(currentWorkspaceId);
  const timezone = useWorkspaceTimezone(currentWorkspaceId);
  const workspaceCurrency = useWorkspaceCurrency(currentWorkspaceId);
  const canView = hasPermission("view_analytics");
  const canSeeRevenue = hasPermission("revenue.view");

  const [now] = useState(() => new Date());
  const range = useMemo(() => resolveDateRangePreset("last_30_days", timezone, now), [timezone, now]);
  const kpisQuery = useAnalyticsKpis(canView ? currentWorkspaceId : null, range);
  const kpis = kpisQuery.data;

  // Reused exactly as CampaignsList/Inbox already check connection state -
  // no second, independently-derived notion of "connected".
  const integrationsQuery = useWorkspaceIntegrations(currentWorkspaceId);
  const integrations = integrationsQuery.data || [];
  const metaConnected = hasCurrentIntegration(integrations, "meta");
  const whatsappConnected = hasCurrentIntegration(integrations, "whatsapp");
  const campaignsQuery = useCampaignPerformance(canView ? currentWorkspaceId : null, range, DEFAULT_ATTRIBUTION_MODEL);
  const conversationsQuery = useInboxConversations(whatsappConnected ? currentWorkspaceId : null);

  const onboardingStatusQuery = useOnboardingStatus(currentWorkspaceId);
  const onboardingComplete = useMemo(() => {
    if (!onboardingStatusQuery.data) return false;
    const items = computeOnboardingItems(onboardingStatusQuery.data);
    const { completed, total } = onboardingProgress(items);
    return completed === total;
  }, [onboardingStatusQuery.data]);

  const spendTotal = kpis ? summarizeCurrency(kpis.spend) : null;
  const revenueTotal = kpis ? summarizeCurrency(kpis.revenue_attributed) : null;
  const roas = kpis && spendTotal?.kind === "single" ? computeRoas(spendTotal.amountMinor, spendTotal.currency, kpis.revenue_attributed) : null;
  const visibleActivity = useMemo(
    () => (activityQuery.data ?? []).filter((row) => isDashboardActivity(row.action)).slice(0, 6),
    [activityQuery.data],
  );

  const unavailableMessage = !canView
    ? "You don't have access"
    : kpisQuery.isError
      ? "Data unavailable"
      : "Loading...";

  // "Established" = the workspace has genuinely started using StabiFlow
  // (real conversations/leads/customers/spend/revenue), independent of
  // whether every onboarding checklist item happens to be ticked. A
  // workspace with real activity should lead with its KPIs even if, say,
  // nobody's tried Flow AI yet; a brand-new workspace should lead with
  // "what to do next" even if onboarding is technically incomplete for
  // an unrelated reason.
  const hasRealActivity = !!kpis && (
    kpis.conversations > 0 ||
    kpis.qualified_leads > 0 ||
    kpis.customers > 0 ||
    spendTotal?.kind === "single" ||
    revenueTotal?.kind === "single"
  );
  const showOnboardingFirst = !onboardingComplete && !hasRealActivity;

  const kpiGrid = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {kpis ? (
        <>
          <MetricCard icon={Wallet} label="Campaign spend (30d)" emptyMessage={metaConnected ? "No data yet" : "Meta not connected"} value={dashboardMoneyValue(kpis.spend, workspaceCurrency)} />
          <MetricCard icon={MessageSquare} label="Conversations (30d)" emptyMessage="WhatsApp not connected" value={dashboardConversationValue(kpis.conversations, whatsappConnected)} />
          <MetricCard icon={Users} label="Qualified leads (30d)" emptyMessage="No leads yet" value={String(kpis.qualified_leads)} />
          <MetricCard icon={DollarSign} label="Customers (30d)" emptyMessage="No customers yet" value={String(kpis.customers)} />
          {canSeeRevenue && <MetricCard icon={TrendingUp} label="Revenue (30d)" emptyMessage="No data yet" value={dashboardMoneyValue(kpis.revenue_attributed, workspaceCurrency)} />}
          {canSeeRevenue && <MetricCard icon={BarChart3} label="ROAS (30d)" emptyMessage="Not enough data yet" value={roas?.status === "ok" || roas?.status === "mixed_currency" ? formatRoas(roas) : undefined} />}
        </>
      ) : (
        <>
          <MetricCard icon={Wallet} label="Campaign spend" emptyMessage={unavailableMessage} />
          <MetricCard icon={MessageSquare} label="Conversations" emptyMessage={unavailableMessage} />
          <MetricCard icon={Users} label="Qualified leads" emptyMessage={unavailableMessage} />
          <MetricCard icon={DollarSign} label="Customers" emptyMessage={unavailableMessage} />
          {canSeeRevenue && <MetricCard icon={TrendingUp} label="Revenue" emptyMessage={unavailableMessage} />}
          {canSeeRevenue && <MetricCard icon={BarChart3} label="ROAS" emptyMessage={unavailableMessage} />}
        </>
      )}
    </div>
  );

  const onboardingBlock = <OnboardingChecklist workspaceId={currentWorkspaceId} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {currentMembership ? `${currentMembership.workspace.name} - business overview` : "Business overview"}
        </p>
      </div>

      {showOnboardingFirst && onboardingBlock}

      {kpiGrid}

      <NeedsAttentionPanel workspaceId={currentWorkspaceId} />

      {!showOnboardingFirst && onboardingBlock}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Campaign performance</CardTitle></CardHeader>
          <CardContent>
            {campaignsQuery.isLoading ? (
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
            ) : campaignsQuery.data?.length ? (
              <ul className="divide-y">
                {campaignsQuery.data.slice(0, 3).map((campaign) => (
                  <li key={campaign.campaign_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate font-medium">{campaign.name}</span>
                    <span className="shrink-0 text-muted-foreground">{formatMoneyByCurrency([{ currency: campaign.currency, amount_minor: campaign.spend_minor }], workspaceCurrency)}</span>
                  </li>
                ))}
              </ul>
            ) : !metaConnected ? (
              <EmptyState
                icon={BarChart3}
                title="No campaign data yet"
                description="Connect your Meta account to launch and track campaigns."
                action={<Button size="sm" onClick={() => navigate("/app/integrations")}>Go to Integrations</Button>}
                className="py-8"
              />
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No campaign data yet"
                description="Launch your first campaign to see performance here."
                action={<Button size="sm" onClick={() => navigate("/app/campaigns/new")}>Create a campaign</Button>}
                className="py-8"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Recent conversations</CardTitle></CardHeader>
          <CardContent>
            {conversationsQuery.isLoading ? (
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
            ) : conversationsQuery.data?.length ? (
              <ul className="divide-y">
                {conversationsQuery.data.slice(0, 3).map((conversation) => (
                  <li key={conversation.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate font-medium">{conversation.display_name || conversation.phone_number}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(conversation.updated_at).toLocaleDateString(undefined, { timeZone: timezone })}</span>
                  </li>
                ))}
              </ul>
            ) : !whatsappConnected ? (
              <EmptyState
                icon={MessageSquare}
                title="No conversations yet"
                description="Connect WhatsApp to start receiving conversations here."
                action={<Button size="sm" onClick={() => navigate("/app/integrations")}>Connect WhatsApp</Button>}
                className="py-8"
              />
            ) : (
              <EmptyState
                icon={MessageSquare}
                title="Waiting for your first conversation"
                description="StabiFlow is connected and ready — new WhatsApp messages will appear here automatically."
                className="py-8"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Flow AI recommendations</CardTitle></CardHeader>
        <CardContent>
          <EmptyState
            icon={Sparkles}
            title="No recommendations yet"
            description="Flow AI needs campaign and conversion data before it can recommend useful next steps."
            action={<Button size="sm" variant="outline" onClick={() => navigate("/app/flow-ai")}>Try Flow AI</Button>}
            className="py-8"
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
          ) : !visibleActivity.length ? (
            <EmptyState icon={TrendingUp} title="No activity yet" description="Actions taken in this workspace will show up here." />
          ) : (
            <ul className="space-y-2">
              {visibleActivity.map((row) => (
                <li key={row.id} className="flex flex-col gap-1 rounded-lg border p-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span>{formatActivityAction(row.action)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString(undefined, { timeZone: timezone })}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
