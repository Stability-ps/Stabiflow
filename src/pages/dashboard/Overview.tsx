import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, BarChart3, Building2, DollarSign, FileText, Megaphone, MessageSquare, Plus, Sparkles, TrendingUp, UserPlus, Users, Wallet,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
  const createActions = [
    hasPermission("lead.create") && { label: "New lead", description: "Add someone to your pipeline", icon: UserPlus, to: "/app/leads" },
    hasPermission("content.create") && { label: "New content", description: "Create or upload marketing content", icon: FileText, to: "/app/content" },
    hasPermission("campaign.create") && { label: "New campaign", description: "Build a campaign for Meta", icon: Megaphone, to: "/app/campaigns/new" },
    { label: "Business profile", description: "Build or update your company profile", icon: Building2, to: "/app/business-studio" },
  ].filter(Boolean) as Array<{ label: string; description: string; icon: typeof Plus; to: string }>;

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

  const formatDashboardTime = (value: string) => {
    const date = new Date(value);
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    const localDay = `${get("year")}-${get("month")}-${get("day")}`;
    const dayKey = (input: Date) => {
      const dayParts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(input);
      const part = (type: Intl.DateTimeFormatPartTypes) => dayParts.find((item) => item.type === type)?.value ?? "";
      return `${part("year")}-${part("month")}-${part("day")}`;
    };
    const todayParts = dayKey(now);
    const yesterdayParts = dayKey(new Date(now.getTime() - 86_400_000));
    const time = `${get("hour")}:${get("minute")}`;
    if (localDay === todayParts) return `Today, ${time}`;
    if (localDay === yesterdayParts) return `Yesterday, ${time}`;
    return new Intl.DateTimeFormat(undefined, { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  };

  const kpiGrid = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {kpis ? (
        <>
          <MetricCard icon={Wallet} label="Campaign spend (30d)" emptyMessage={metaConnected ? "— · No spend recorded yet" : "— · Meta not connected"} value={dashboardMoneyValue(kpis.spend, workspaceCurrency)} onClick={() => navigate("/app/campaigns")} />
          <MetricCard icon={MessageSquare} label="Conversations (30d)" emptyMessage="— · WhatsApp not connected" value={dashboardConversationValue(kpis.conversations, whatsappConnected)} onClick={() => navigate("/app/messages")} />
          <MetricCard icon={Users} label="Qualified leads (30d)" emptyMessage="— · No leads yet" value={String(kpis.qualified_leads)} onClick={() => navigate("/app/leads")} />
          <MetricCard icon={DollarSign} label="Customers (30d)" emptyMessage="— · No customers yet" value={String(kpis.customers)} onClick={() => navigate("/app/customers")} />
          {canSeeRevenue && <MetricCard icon={TrendingUp} label="Revenue (30d)" emptyMessage="— · No revenue recorded yet" value={dashboardMoneyValue(kpis.revenue_attributed, workspaceCurrency)} onClick={() => navigate("/app/analytics")} />}
          {canSeeRevenue && <MetricCard icon={BarChart3} label="ROAS (30d)" emptyMessage="— · Needs spend and revenue data" value={roas?.status === "ok" || roas?.status === "mixed_currency" ? formatRoas(roas) : undefined} onClick={() => navigate("/app/analytics")} />}
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
    <div className="mx-auto max-w-[1440px] space-y-5">
      <div className="relative overflow-hidden rounded-3xl border border-sky-100/80 bg-gradient-to-br from-white via-white to-sky-50/80 p-4 shadow-[0_18px_60px_-42px_hsl(213_82%_45%/0.45)] sm:p-5">
        <div className="pointer-events-none absolute -right-20 -top-28 h-64 w-64 rounded-full bg-sky-200/25 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace overview</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {currentMembership ? currentMembership.workspace.name : "Dashboard"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Your business command centre — priorities, performance and activity in one place.</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="shrink-0 gap-2 shadow-sm">
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 p-2">
            <DropdownMenuLabel className="px-2 py-1.5">
              <span className="block text-sm font-semibold">Create something</span>
              <span className="block text-xs font-normal text-muted-foreground">Start from the right place in StabiFlow.</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {createActions.map((action) => (
              <DropdownMenuItem key={action.label} onClick={() => navigate(action.to)} className="gap-3 rounded-lg p-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <action.icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{action.label}</span>
                  <span className="block text-xs text-muted-foreground">{action.description}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {showOnboardingFirst && onboardingBlock}

      {kpiGrid}

      <NeedsAttentionPanel workspaceId={currentWorkspaceId} />

      {!showOnboardingFirst && onboardingBlock}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border/60 bg-card/90 shadow-[0_12px_40px_-32px_hsl(213_45%_30%/0.35)]">
          <CardHeader className="pb-2"><CardTitle className="text-base">Campaign performance</CardTitle></CardHeader>
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
                className="py-4"
              />
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No campaign data yet"
                description="Launch your first campaign to see performance here."
                action={<Button size="sm" onClick={() => navigate("/app/campaigns/new")}>Create a campaign</Button>}
                className="py-4"
              />
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/90 shadow-[0_12px_40px_-32px_hsl(213_45%_30%/0.35)]">
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent conversations</CardTitle></CardHeader>
          <CardContent>
            {conversationsQuery.isLoading ? (
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
            ) : conversationsQuery.data?.length ? (
              <ul className="divide-y">
                {conversationsQuery.data.slice(0, 3).map((conversation) => (
                  <li key={conversation.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate font-medium">{conversation.display_name || conversation.phone_number}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDashboardTime(conversation.updated_at)}</span>
                  </li>
                ))}
              </ul>
            ) : !whatsappConnected ? (
              <EmptyState
                icon={MessageSquare}
                title="No conversations yet"
                description="Connect WhatsApp to start receiving conversations here."
                action={<Button size="sm" onClick={() => navigate("/app/integrations")}>Connect WhatsApp</Button>}
                className="py-4"
              />
            ) : (
              <EmptyState
                icon={MessageSquare}
                title="Waiting for your first conversation"
                description="StabiFlow is connected and ready — new WhatsApp messages will appear here automatically."
                className="py-4"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/10 bg-gradient-to-r from-sky-50/70 via-card/90 to-violet-50/50 shadow-[0_12px_40px_-32px_hsl(213_45%_30%/0.35)]">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold">Flow AI recommendations</p>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                No recommendations yet. As StabiFlow collects campaign and conversion data, useful next steps will appear here.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 gap-2" onClick={() => navigate("/app/flow-ai")}>
            Open Flow AI
            <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/90 shadow-[0_12px_40px_-32px_hsl(213_45%_30%/0.35)]">
        <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
        <CardContent>
          {activityQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : activityQuery.isError ? (
            <p className="text-sm text-destructive">Unable to load recent activity.</p>
          ) : !visibleActivity.length ? (
            <EmptyState icon={TrendingUp} title="No activity yet" description="Actions taken in this workspace will show up here." className="py-4" />
          ) : (
            <ul className="space-y-2">
              {visibleActivity.map((row) => (
                <li key={row.id} className="flex flex-col gap-1 rounded-lg border p-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span>{formatActivityAction(row.action)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDashboardTime(row.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
