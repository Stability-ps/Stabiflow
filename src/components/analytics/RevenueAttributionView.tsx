import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { RevenueAnalyticsSection } from "@/components/analytics/RevenueAnalyticsSection";
import { CampaignPerformanceTable } from "@/components/analytics/CampaignPerformanceTable";
import { RevenueBreakdownSection } from "@/components/analytics/RevenueBreakdownSection";
import { useRevenueBreakdown } from "@/hooks/useRevenueBreakdown";
import type { AnalyticsKpis, CampaignPerformanceRow } from "@/hooks/useAnalytics";
import type { AttributionModel } from "@/lib/analytics";
import { summarizeCurrency } from "@/lib/analytics";
import type { DateRange, DateRangePreset } from "@/lib/analyticsDate";

// The Revenue view. Leads with recorded-revenue totals and the
// attributed / unattributed split (get_analytics_kpis), then revenue by
// campaign (get_campaign_performance, re-sorted revenue-first), then the
// two SQL-backed slices (get_revenue_breakdown: source, assist) and the
// day time-series. Nothing here invents a dimension - each is backed by a
// real query.
export function RevenueAttributionView({
  workspaceId,
  range,
  preset,
  kpis,
  campaignRows,
  campaignsLoading,
  canSeeRevenue,
  workspaceCurrency,
  attributionModel,
}: {
  workspaceId: string | null;
  range: DateRange;
  preset: DateRangePreset;
  kpis: AnalyticsKpis;
  campaignRows: CampaignPerformanceRow[];
  campaignsLoading: boolean;
  canSeeRevenue: boolean;
  workspaceCurrency: string;
  attributionModel: AttributionModel;
}) {
  const bySource = useRevenueBreakdown(canSeeRevenue ? workspaceId : null, range, "source");
  const byAssist = useRevenueBreakdown(canSeeRevenue ? workspaceId : null, range, "assist");
  const byDay = useRevenueBreakdown(canSeeRevenue ? workspaceId : null, range, "day");

  if (!canSeeRevenue) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Revenue attribution"
        description="You don't have permission to view revenue for this workspace. Ask a workspace owner or admin."
      />
    );
  }

  const revenueFirst = [...campaignRows].sort((a, b) => {
    const at = summarizeCurrency(a.revenue);
    const bt = summarizeCurrency(b.revenue);
    return (bt.kind === "single" ? bt.amountMinor : 0) - (at.kind === "single" ? at.amountMinor : 0);
  });

  const noRevenueAtAll =
    summarizeCurrency(kpis.revenue_total).kind === "empty" &&
    bySource.data?.length === 0 &&
    !bySource.isLoading;

  return (
    <div className="space-y-6">
      <RevenueAnalyticsSection kpis={kpis} workspaceCurrency={workspaceCurrency} />

      {noRevenueAtAll ? (
        <EmptyState
          icon={BarChart3}
          title="No revenue recorded in this range"
          description="Revenue appears here once it's recorded against a customer or opportunity — mark an opportunity won and record the sale, or add a revenue event from a customer's record."
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <RevenueBreakdownSection
              title="Revenue by source"
              description="Where the money came from, by how confidently we can attribute it."
              rows={bySource.data || []}
              isLoading={bySource.isLoading}
              isError={bySource.isError}
              workspaceCurrency={workspaceCurrency}
              emptyHint="Recorded revenue will be classified here by its attribution evidence."
            />
            <RevenueBreakdownSection
              title="AI-assisted vs human-assisted"
              description="Whether the originating WhatsApp conversation was handled by AI or a person."
              rows={byAssist.data || []}
              isLoading={byAssist.isLoading}
              isError={byAssist.isError}
              workspaceCurrency={workspaceCurrency}
              emptyHint="Revenue linked to a WhatsApp conversation is split by who handled it."
            />
          </div>

          <RevenueBreakdownSection
            title="Revenue over time"
            description="Daily recorded revenue for the selected range."
            rows={byDay.data || []}
            isLoading={byDay.isLoading}
            isError={byDay.isError}
            workspaceCurrency={workspaceCurrency}
            emptyHint="Days with recorded revenue will appear here."
          />

          <div>
            <h2 className="mb-1 text-sm font-semibold">Revenue by campaign</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Per-campaign spend, funnel counts, cost-per-lead, revenue and ROAS under the selected attribution model.
            </p>
            {campaignsLoading ? (
              <div className="h-32 animate-pulse rounded-lg bg-muted" />
            ) : (
              <CampaignPerformanceTable
                rows={revenueFirst}
                canSeeRevenue={canSeeRevenue}
                attributionModel={attributionModel}
                preset={preset}
                workspaceCurrency={workspaceCurrency}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
