import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart3, Building2, DollarSign, FileText, Lock, Megaphone, MessageSquare, Plus, Sparkles, TrendingUp, UserPlus, Users, Wallet,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useWorkspaceActivity } from "@/hooks/useWorkspaceActivity";
import { useInboxConversations } from "@/hooks/useInboxConversations";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";
import { useAnalyticsKpis, useCampaignPerformance } from "@/hooks/useAnalytics";
import { useWorkspaceIntegrations } from "@/hooks/useIntegrations";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useWorkspaceCurrency } from "@/hooks/useWorkspaceCurrency";
import { useNeedsAttention } from "@/hooks/useNeedsAttention";
import { Button } from "@/components/ui/button";
import { Metric, type MetricState } from "@/components/ui/metric";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/EmptyState";
import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist";
import { NeedsAttentionPanel } from "@/components/dashboard/NeedsAttentionPanel";
import { computeOnboardingItems, onboardingProgress } from "@/lib/onboarding";
import { computeRoas, DEFAULT_ATTRIBUTION_MODEL, formatMoneyByCurrency, formatRoas, summarizeCurrency } from "@/lib/analytics";
import { formatActivityAction, isDashboardActivity } from "@/lib/activityPresentation";
import { resolveDateRangePreset } from "@/lib/analyticsDate";
import { inboxStatusLabel } from "@/lib/inboxPresentation";
import { relativeTimeShort } from "@/lib/needsAttention";
import { MODULE_LOCK_INFO } from "@/lib/moduleLockInfo";
import type { FeatureFlagKey } from "@/lib/featureFlags";
import {
  dashboardConversationValue, dashboardMoneyValue, greetingFor, hasCurrentIntegration, homeMetricState, isMeasuredZeroMoney,
} from "@/lib/dashboardPresentation";

const CONVERSATION_TONE: Record<string, StatusTone> = { new: "info", unassigned: "warning", assigned: "neutral", waiting_client: "neutral", resolved: "success" };
const CAMPAIGN_TONE: Record<string, StatusTone> = { active: "success", published: "success", scheduled: "info", paused: "neutral", draft: "neutral", failed: "danger", error: "danger" };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="rounded text-sm font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </Link>
  );
}

/** A module the workspace's plan doesn't include - explains and points at the existing upgrade flow. */
function LockedPanelBody({ flag, what, plural = false }: { flag: FeatureFlagKey; what: string; plural?: boolean }) {
  const plans = MODULE_LOCK_INFO[flag]?.plans ?? "a higher plan";
  return (
    <div className="flex items-start gap-3 px-4 py-5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted"><Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{what} {plural ? "are" : "is"} part of the {plans}.</p>
        <Link to="/app/billing" className="mt-1 inline-block text-sm font-medium text-link hover:underline">See plans</Link>
      </div>
    </div>
  );
}

// Same authoritative analytics read model /analytics uses (get_analytics_kpis)
// - a fixed "last 30 days" window, since the homepage is a glance, not the
// full reporting surface. Never a second, independently-computed set of
// formulas that could quietly disagree with /analytics.
export default function Overview() {
  const navigate = useNavigate();
  const { currentMembership, currentWorkspaceId, hasPermission, profile } = useAuth();
  const { isEnabled, isPlanLocked } = useFeatureFlags();
  const activityQuery = useWorkspaceActivity(currentWorkspaceId);
  const timezone = useWorkspaceTimezone(currentWorkspaceId);
  const workspaceCurrency = useWorkspaceCurrency(currentWorkspaceId);
  const canView = hasPermission("view_analytics");
  const canSeeRevenue = hasPermission("revenue.view");
  const createActions = [
    hasPermission("lead.create") && { label: "New lead", description: "Add someone to your pipeline", icon: UserPlus, to: "/app/leads?new=1" },
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
  const attention = useNeedsAttention(currentWorkspaceId);

  // Display only: which modules the plan doesn't include (FeatureGate and
  // the database keep enforcing access).
  const lockedPlan = (flag: FeatureFlagKey) => (isPlanLocked(flag) ? MODULE_LOCK_INFO[flag]?.plans ?? "a higher plan" : null);
  const moduleLink = (flag: FeatureFlagKey, to: string) => (isEnabled(flag) || isPlanLocked(flag) ? to : undefined);

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

  const workspaceName = currentMembership?.workspace.name ?? "your workspace";
  const firstName = profile?.full_name?.trim().split(/\s+/)[0];
  const greeting = `${greetingFor(now, timezone)}${firstName ? `, ${firstName}` : ""}`;
  const attentionCount = attention.isLoading ? null : attention.items.length;
  const subtitle = attentionCount === null
    ? `Here's what's happening across ${workspaceName}.`
    : attentionCount === 0
      ? `Nothing needs you right now across ${workspaceName}.`
      : `${attentionCount} ${attentionCount === 1 ? "thing needs" : "things need"} you across ${workspaceName}.`;

  // Money tiles span the full width on narrow phones so full currency
  // values ("ZAR 48,210.00") never break mid-number.
  type Tile = { key: string; label: string; icon: typeof Wallet; state: MetricState; to?: string; wide?: boolean };
  const tiles: Tile[] = [];
  const icon = (I: typeof Wallet) => <I className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  if (!canView) {
    // Restricted by permissions: say so instead of showing empty numbers.
  } else if (!kpis) {
    const note = kpisQuery.isError ? "Couldn't load right now" : undefined;
    for (const [key, label, I] of [["spend", "Campaign spend", Wallet], ["conversations", "Conversations", MessageSquare], ["leads", "Qualified leads", Users], ["customers", "Customers", DollarSign]] as const) {
      tiles.push({ key, label, icon: I, state: kpisQuery.isError ? { kind: "no_data", note } : { kind: "no_data", note: "Loading…" } });
    }
  } else {
    tiles.push({
      key: "spend", label: "Campaign spend", icon: Wallet, wide: true,
      to: !isPlanLocked("module.campaigns") && !metaConnected ? "/app/integrations" : moduleLink("module.campaigns", "/app/campaigns"),
      state: homeMetricState({
        lockedPlan: lockedPlan("module.campaigns"), connected: metaConnected, connectNote: "Connect Meta to track spend",
        value: dashboardMoneyValue(kpis.spend, workspaceCurrency), measuredZero: isMeasuredZeroMoney(kpis.spend),
        note: "Last 30 days", zeroNote: "No spend in the last 30 days", noDataNote: "No spend recorded in the last 30 days",
      }),
    });
    tiles.push({
      key: "conversations", label: "Conversations", icon: MessageSquare,
      to: !isPlanLocked("module.whatsapp") && !whatsappConnected ? "/app/integrations" : moduleLink("module.whatsapp", "/app/whatsapp/inbox"),
      state: homeMetricState({
        lockedPlan: lockedPlan("module.whatsapp"), connected: whatsappConnected || kpis.conversations > 0, connectNote: "Connect WhatsApp to receive messages",
        value: dashboardConversationValue(kpis.conversations, whatsappConnected), measuredZero: kpis.conversations === 0,
        note: "Last 30 days", zeroNote: "No conversations in the last 30 days",
      }),
    });
    tiles.push({
      key: "leads", label: "Qualified leads", icon: Users, to: moduleLink("module.leads", "/app/leads"),
      state: homeMetricState({
        lockedPlan: lockedPlan("module.leads"), value: String(kpis.qualified_leads), measuredZero: kpis.qualified_leads === 0,
        note: "Last 30 days", zeroNote: "None qualified in the last 30 days",
      }),
    });
    tiles.push({
      key: "customers", label: "Customers", icon: DollarSign, to: moduleLink("module.customers", "/app/customers"),
      state: homeMetricState({
        lockedPlan: lockedPlan("module.customers"), value: String(kpis.customers), measuredZero: kpis.customers === 0,
        note: "Last 30 days", zeroNote: "None won in the last 30 days",
      }),
    });
    if (canSeeRevenue) {
      tiles.push({
        key: "roas", label: "ROAS", icon: BarChart3, to: moduleLink("module.analytics", "/app/analytics"),
        state: homeMetricState({
          lockedPlan: lockedPlan("module.campaigns"), connected: metaConnected, connectNote: "Connect Meta to measure return on spend",
          value: roas?.status === "ok" || roas?.status === "mixed_currency" ? formatRoas(roas) : undefined,
          note: "Attributed revenue ÷ spend", noDataNote: "Needs ad spend and attributed revenue",
        }),
      });
      tiles.push({
        key: "revenue", label: "Revenue", icon: TrendingUp, wide: true, to: moduleLink("module.analytics", "/app/analytics?view=revenue"),
        state: homeMetricState({
          value: dashboardMoneyValue(kpis.revenue_attributed, workspaceCurrency), measuredZero: isMeasuredZeroMoney(kpis.revenue_attributed),
          note: "Attributed, last 30 days", zeroNote: "No attributed revenue yet", noDataNote: "No revenue recorded in the last 30 days",
        }),
      });
    }
  }

  const kpiGrid = canView ? (
    <section aria-label="Key metrics, last 30 days" className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {tiles.map((t) => <Metric key={t.key} label={t.label} state={t.state} icon={icon(t.icon)} to={t.to} className={t.wide ? "min-[360px]:col-span-2 sm:col-span-1" : undefined} />)}
    </section>
  ) : (
    <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      Your role doesn&apos;t include analytics, so performance numbers are hidden. Ask a workspace owner if you need them.
    </p>
  );

  const onboardingBlock = <OnboardingChecklist workspaceId={currentWorkspaceId} />;
  const campaignsLocked = isPlanLocked("module.campaigns");
  const whatsappLocked = isPlanLocked("module.whatsapp");
  const flowAiState = isEnabled("module.flow_ai") ? "enabled" : isPlanLocked("module.flow_ai") ? "locked" : "hidden";

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title-page text-foreground">{greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="shrink-0">
              <Plus aria-hidden="true" />
              Create
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 p-1.5">
            <DropdownMenuLabel className="px-2 py-1.5">
              <span className="block text-sm font-semibold">Create something</span>
              <span className="block text-xs font-normal text-muted-foreground">Start from the right place in StabiFlow.</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {createActions.map((action) => (
              <DropdownMenuItem key={action.label} onClick={() => navigate(action.to)} className="gap-3 rounded-md p-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  <action.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{action.label}</span>
                  <span className="block text-xs text-muted-foreground">{action.description}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {showOnboardingFirst && onboardingBlock}

      {kpiGrid}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22.5rem)]">
        <div className="min-w-0 space-y-4">
          <NeedsAttentionPanel workspaceId={currentWorkspaceId} />

          <Panel aria-labelledby="home-campaigns-title">
            <PanelHeader
              titleId="home-campaigns-title"
              title="Campaign performance"
              description="Last 30 days"
              action={!campaignsLocked && campaignsQuery.data?.length ? <PanelLink to="/app/campaigns">Open campaigns</PanelLink> : undefined}
            />
            {campaignsLocked ? (
              <LockedPanelBody flag="module.campaigns" what="Campaigns" plural />
            ) : campaignsQuery.isLoading ? (
              <div className="space-y-3 p-4" role="status" aria-label="Loading"><div className="h-10 animate-pulse rounded-md bg-muted" /><div className="h-10 animate-pulse rounded-md bg-muted" /></div>
            ) : campaignsQuery.data?.length ? (
              <ul className="divide-y divide-border">
                {campaignsQuery.data.slice(0, 3).map((campaign) => (
                  <li key={campaign.campaign_id}>
                    <Link to={`/app/campaigns/${campaign.campaign_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{campaign.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {campaign.leads} {campaign.leads === 1 ? "lead" : "leads"} · {campaign.customers} {campaign.customers === 1 ? "customer" : "customers"}
                        </span>
                      </span>
                      {campaign.status ? <StatusPill tone={CAMPAIGN_TONE[campaign.status.toLowerCase()] ?? "neutral"} className="hidden capitalize sm:inline-flex">{campaign.status.toLowerCase()}</StatusPill> : null}
                      <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{formatMoneyByCurrency([{ currency: campaign.currency, amount_minor: campaign.spend_minor }], workspaceCurrency)}</span>
                    </Link>
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
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel aria-labelledby="home-conversations-title">
            <PanelHeader
              titleId="home-conversations-title"
              title="Recent conversations"
              action={!whatsappLocked && conversationsQuery.data?.length ? <PanelLink to="/app/whatsapp/inbox">Inbox</PanelLink> : undefined}
            />
            {whatsappLocked ? (
              <LockedPanelBody flag="module.whatsapp" what="Messages" />
            ) : conversationsQuery.isLoading ? (
              <div className="space-y-3 p-4" role="status" aria-label="Loading"><div className="h-10 animate-pulse rounded-md bg-muted" /><div className="h-10 animate-pulse rounded-md bg-muted" /></div>
            ) : conversationsQuery.data?.length ? (
              <ul className="divide-y divide-border">
                {conversationsQuery.data.slice(0, 3).map((conversation) => {
                  const name = conversation.display_name || conversation.phone_number;
                  return (
                    <li key={conversation.id}>
                      <Link
                        to="/app/whatsapp/inbox"
                        state={{ selectedId: conversation.id }}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-selected text-xs font-semibold text-selected-foreground" aria-hidden="true">
                          {conversation.display_name ? initials(conversation.display_name) : <MessageSquare className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{name}</span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <time dateTime={conversation.updated_at} className="text-xs text-muted-foreground">{relativeTimeShort(conversation.updated_at)}</time>
                          {conversation.inbox_status ? <StatusPill tone={CONVERSATION_TONE[conversation.inbox_status] ?? "neutral"} dot={false}>{inboxStatusLabel(conversation.inbox_status)}</StatusPill> : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
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
          </Panel>

          {flowAiState !== "hidden" && (
            <Panel aria-labelledby="home-flowai-title">
              <PanelHeader
                titleId="home-flowai-title"
                title="Flow AI recommendations"
                action={flowAiState === "enabled" ? <PanelLink to="/app/flow-ai">Open Flow AI</PanelLink> : undefined}
              />
              {flowAiState === "locked" ? (
                <LockedPanelBody flag="module.flow_ai" what="Flow AI" />
              ) : (
                <div className="flex items-start gap-3 px-4 py-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft"><Sparkles className="h-4 w-4 text-brand" aria-hidden="true" /></span>
                  <p className="text-sm text-muted-foreground">
                    No recommendations yet. As StabiFlow collects campaign and conversion data, useful next steps will appear here.
                  </p>
                </div>
              )}
            </Panel>
          )}

          <Panel aria-labelledby="home-activity-title">
            <PanelHeader titleId="home-activity-title" title="Recent activity" />
            {activityQuery.isLoading ? (
              <div className="space-y-3 p-4" role="status" aria-label="Loading"><div className="h-8 animate-pulse rounded-md bg-muted" /><div className="h-8 animate-pulse rounded-md bg-muted" /></div>
            ) : activityQuery.isError ? (
              <p className="px-4 py-4 text-sm text-destructive">Unable to load recent activity.</p>
            ) : !visibleActivity.length ? (
              <EmptyState icon={TrendingUp} title="No activity yet" description="Actions taken in this workspace will show up here." className="py-4" />
            ) : (
              <ul className="divide-y divide-border">
                {visibleActivity.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 text-sm text-foreground">{formatActivityAction(row.action)}</span>
                    <time dateTime={row.created_at} className="shrink-0 text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString(undefined, { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {!showOnboardingFirst && onboardingBlock}
    </div>
  );
}
