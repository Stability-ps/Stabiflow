import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3 } from "lucide-react";
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
import {
  useAnalyticsKpis, useCampaignPerformance, useCreativePerformance, useLeadSourceBreakdown, useWhatsAppAnalytics,
} from "@/hooks/useAnalytics";
import { cn } from "@/lib/utils";
import { DEFAULT_ATTRIBUTION_MODEL, type AttributionModel } from "@/lib/analytics";
import { previousComparisonRange, resolveDateRangePreset, type DateRangePreset } from "@/lib/analyticsDate";

type AnalyticsView = "overview" | "revenue";

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
  const view: AnalyticsView = canSeeRevenue && searchParams.get("view") === "revenue" ? "revenue" : "overview";
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

  useEffect(() => {
    if (fromWhatsApp && whatsappQuery.data && whatsappSectionRef.current) {
      whatsappSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [fromWhatsApp, whatsappQuery.data]);

  if (!currentWorkspaceId) return <div className="h-[70vh] animate-pulse rounded-lg bg-muted" />;

  if (!canView) {
    return <EmptyState icon={BarChart3} title="Analytics" description="You don't have permission to view this workspace's analytics. Ask a workspace owner or admin." />;
  }

  return (
    <div className="space-y-6">
      {fromWhatsApp && <WhatsAppContextBanner label="Viewing WhatsApp conversion analytics." />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">Spend, conversations, leads, customers, revenue, and cost-per-outcome, all the way through the funnel.</p>
        </div>
        <AnalyticsControls
          preset={preset} onPresetChange={setPreset}
          customFrom={customFrom} customTo={customTo} onCustomFromChange={setCustomFrom} onCustomToChange={setCustomTo}
          attributionModel={attributionModel} onAttributionModelChange={setAttributionModel}
        />
      </div>

      <nav className="flex gap-1 border-b" aria-label="Analytics views">
        {(canSeeRevenue ? ([["overview", "Overview"], ["revenue", "Revenue"]] as const) : ([["overview", "Overview"]] as const)).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            aria-current={view === key ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              view === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {!range ? (
        <EmptyState icon={BarChart3} title="Choose a date range" description="Pick both a start and end date to see analytics for a custom range." />
      ) : kpisQuery.isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : kpisQuery.isError ? (
        <EmptyState icon={BarChart3} title="Unable to load analytics" description="Something went wrong loading analytics for this workspace. Try again shortly." />
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
          {canSeeRevenue && <RevenueAnalyticsSection kpis={kpisQuery.data} workspaceCurrency={workspaceCurrency} />}
          <CampaignPerformanceTable
            rows={campaignsQuery.data || []}
            canSeeRevenue={canSeeRevenue}
            attributionModel={attributionModel}
            preset={preset}
            workspaceCurrency={workspaceCurrency}
          />
          <CreativePerformanceTable rows={creativesQuery.data || []} canSeeRevenue={canSeeRevenue} workspaceCurrency={workspaceCurrency} />
          <div ref={whatsappSectionRef} id="whatsapp-analytics" className="grid scroll-mt-20 gap-4 lg:grid-cols-2">
            <SourceBreakdownSection rows={sourcesQuery.data || []} />
            {whatsappQuery.data && <WhatsAppAnalyticsSection data={whatsappQuery.data} />}
          </div>
        </>
      ) : null}
    </div>
  );
}
