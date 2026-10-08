import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionError } from "@/components/analytics/SectionError";
import { WhatsAppContextBanner } from "@/components/whatsapp/WhatsAppContextBanner";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";
import { useWorkspaceCurrency } from "@/hooks/useWorkspaceCurrency";
import { markAnalyticsVisited } from "@/hooks/useOnboardingStatus";
import { EmptyState } from "@/components/EmptyState";
import { AnalyticsControls } from "@/components/analytics/AnalyticsControls";
import { KpiCards } from "@/components/analytics/KpiCards";
import { FunnelSection } from "@/components/analytics/FunnelSection";
import { CampaignPerformanceTable } from "@/components/analytics/CampaignPerformanceTable";
import { CreativePerformanceTable } from "@/components/analytics/CreativePerformanceTable";
import { SourceBreakdownSection } from "@/components/analytics/SourceBreakdownSection";
import { WhatsAppAnalyticsSection } from "@/components/analytics/WhatsAppAnalyticsSection";
import { RevenueAnalyticsSection } from "@/components/analytics/RevenueAnalyticsSection";
import { RevenueAttributionView } from "@/components/analytics/RevenueAttributionView";
import { CrmPerformanceSection } from "@/components/analytics/CrmPerformanceSection";
import { CreatorCampaignsSection } from "@/components/analytics/CreatorCampaignsSection";
import {
  useAnalyticsKpis, useCampaignPerformance, useCreativePerformance, useLeadSourceBreakdown, useWhatsAppAnalytics, useCrmPerformance,
} from "@/hooks/useAnalytics";
import { cn } from "@/lib/utils";
import { DEFAULT_ATTRIBUTION_MODEL, type AttributionModel } from "@/lib/analytics";
import { previousComparisonRange, resolveDateRangePreset, type DateRangePreset } from "@/lib/analyticsDate";

type AnalyticsView = "overview" | "creators" | "revenue";

export default function Analytics() {
  const { currentWorkspaceId, hasPermission } = useAuth();
  const timezone = useWorkspaceTimezone(currentWorkspaceId);
  const workspaceCurrency = useWorkspaceCurrency(currentWorkspaceId);

  useEffect(() => {
    if (currentWorkspaceId) markAnalyticsVisited(currentWorkspaceId);
  }, [currentWorkspaceId]);

  // Entered from WhatsApp > Analytics: keep the "came from WhatsApp"
  // context and scroll the WhatsApp conversion card into view.
  const [searchParams, setSearchParams] = useSearchParams();
  const fromWhatsApp = searchParams.has("whatsapp");
  const whatsappSectionRef = useRef<HTMLDivElement | null>(null);
  const canView = hasPermission("view_analytics");
  const canSeeRevenue = hasPermission("revenue.view");

  // The Revenue view is only reachable with revenue.view - a viewer/
  // marketing role without it never sees a selectable tab that would only
  // ever show a permission wall (audit §19). Backend/RPC stay authoritative.
  const requestedView = searchParams.get("view");
  const view: AnalyticsView = requestedView === "creators" ? "creators" : canSeeRevenue && requestedView === "revenue" ? "revenue" : "overview";
  const setView = (next: AnalyticsView) => {
    const params = new URLSearchParams(searchParams);
    if (next === "overview") params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
  };

  const [preset, setPreset] = useState<DateRangePreset>("last_30_days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [attributionModel, setAttributionModel] = useState<AttributionModel>(DEFAULT_ATTRIBUTION_MODEL);

  // `now` is captured once per mount/preset-change rather than recomputed
  // on every render, so the resolved range (and therefore every query key
  // below) stays stable within a session instead of drifting second to
  // second.
  const [now] = useState(() => new Date());

  const range = useMemo(() => {
    if (preset === "custom" && (!customFrom || !customTo)) return null;
    try {
      return resolveDateRangePreset(preset, timezone, now, preset === "custom" ? { fromDateStr: customFrom, toDateStr: customTo } : undefined);
    } catch {
      return null;
    }
  }, [preset, customFrom, customTo, timezone, now]);

  const previousRange = useMemo(() => (range ? previousComparisonRange(range) : null), [range]);

  const kpisQuery = useAnalyticsKpis(canView ? currentWorkspaceId : null, range);
  const previousKpisQuery = useAnalyticsKpis(canView ? currentWorkspaceId : null, previousRange);
  const campaignsQuery = useCampaignPerformance(canView ? currentWorkspaceId : null, range, attributionModel);
  const creativesQuery = useCreativePerformance(canView ? currentWorkspaceId : null, range, attributionModel);
  const sourcesQuery = useLeadSourceBreakdown(canView ? currentWorkspaceId : null, range);
  const whatsappQuery = useWhatsAppAnalytics(canView ? currentWorkspaceId : null, range);
  const crmQuery = useCrmPerformance(canView ? currentWorkspaceId : null, range);

  useEffect(() => {
    if (fromWhatsApp && whatsappQuery.data && whatsappSectionRef.current) {
      whatsappSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [fromWhatsApp, whatsappQuery.data]);

  if (!currentWorkspaceId) return <div className="h-[70vh] animate-pulse rounded-lg bg-muted" />;

  if (!canView) {
    return <EmptyState icon={BarChart3} title="Analytics" description="You don't have permission to view this workspace's analytics. Ask a workspace owner or admin." className="rounded-xl border border-border bg-card" />;
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5">
      {fromWhatsApp && <WhatsAppContextBanner label="Viewing WhatsApp conversion analytics." />}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title-page text-foreground">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">Spend, conversations, leads, customers and revenue - all the way through the funnel.</p>
        </div>
        <AnalyticsControls
          preset={preset} onPresetChange={setPreset}
          customFrom={customFrom} customTo={customTo} onCustomFromChange={setCustomFrom} onCustomToChange={setCustomTo}
          attributionModel={attributionModel} onAttributionModelChange={setAttributionModel}
        />
      </header>

      <nav className="-mx-1 flex max-w-full overflow-x-auto px-1" aria-label="Analytics views">
        <div className="inline-flex shrink-0 gap-0.5 rounded-lg border border-border bg-muted p-0.5">
          {(canSeeRevenue ? ([["overview", "Overview"], ["creators", "Creator campaigns"], ["revenue", "Revenue"]] as const) : ([["overview", "Overview"], ["creators", "Creator campaigns"]] as const)).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-current={view === key ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === key ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      {!range ? (
        <EmptyState icon={BarChart3} title="Choose a date range" description="Pick both a start and end date to see analytics for a custom range." className="rounded-xl border border-border bg-card" />
      ) : kpisQuery.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading analytics">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[6.5rem] animate-pulse rounded-xl bg-muted" />)}</div>
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : kpisQuery.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load analytics"
          description="Something went wrong loading analytics for this workspace. Your data is safe - try again."
          action={<Button variant="outline" onClick={() => void kpisQuery.refetch()}>Try again</Button>}
          className="rounded-xl border border-border bg-card"
        />
      ) : kpisQuery.data && view === "creators" ? (
        <CreatorCampaignsSection workspaceId={currentWorkspaceId} canSeeRevenue={canSeeRevenue} />
      ) : kpisQuery.data && view === "revenue" ? (
        <RevenueAttributionView
          workspaceId={currentWorkspaceId}
          range={range}
          preset={preset}
          kpis={kpisQuery.data}
          campaignRows={campaignsQuery.data || []}
          campaignsLoading={campaignsQuery.isLoading}
          canSeeRevenue={canSeeRevenue}
          workspaceCurrency={workspaceCurrency}
          attributionModel={attributionModel}
        />
      ) : kpisQuery.data ? (
        <>
          <KpiCards kpis={kpisQuery.data} previous={previousKpisQuery.data} canSeeRevenue={canSeeRevenue} workspaceCurrency={workspaceCurrency} />
          <FunnelSection kpis={kpisQuery.data} />
          {crmQuery.isError ? <SectionError title="CRM performance" onRetry={() => void crmQuery.refetch()} /> : crmQuery.data && <CrmPerformanceSection data={crmQuery.data} />}
          {canSeeRevenue && <RevenueAnalyticsSection kpis={kpisQuery.data} workspaceCurrency={workspaceCurrency} />}
          {campaignsQuery.isError ? <SectionError title="Campaign performance" onRetry={() => void campaignsQuery.refetch()} /> : <CampaignPerformanceTable
            rows={campaignsQuery.data || []}
            canSeeRevenue={canSeeRevenue}
            attributionModel={attributionModel}
            preset={preset}
            workspaceCurrency={workspaceCurrency}
          />}
          {creativesQuery.isError ? <SectionError title="Creative performance" onRetry={() => void creativesQuery.refetch()} /> : <CreativePerformanceTable rows={creativesQuery.data || []} canSeeRevenue={canSeeRevenue} workspaceCurrency={workspaceCurrency} />}
          <div ref={whatsappSectionRef} id="whatsapp-analytics" className="grid scroll-mt-20 gap-4 lg:grid-cols-2">
            {sourcesQuery.isError ? <SectionError title="Where leads come from" onRetry={() => void sourcesQuery.refetch()} /> : <SourceBreakdownSection rows={sourcesQuery.data || []} />}
            {whatsappQuery.isError ? <SectionError title="WhatsApp conversion" onRetry={() => void whatsappQuery.refetch()} /> : whatsappQuery.data && <WhatsAppAnalyticsSection data={whatsappQuery.data} />}
          </div>
        </>
      ) : null}
    </div>
  );
}
