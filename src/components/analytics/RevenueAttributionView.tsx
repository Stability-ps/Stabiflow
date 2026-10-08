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

// The Revenue view keeps two analytical questions SEPARATE (audit HIGH-5 / §8):
//
//   A. Campaign attribution  - "how much revenue is tied to a campaign?"
//      Shown by RevenueAnalyticsSection (get_analytics_kpis):
//      Total / Attributed to a known campaign / Unattributed.
//
//   B. Attribution evidence  - "what evidence exists for how this revenue
//      was acquired?"  Shown by the "Revenue by attribution evidence" card
//      (get_revenue_breakdown, source dimension): Confirmed Meta campaign
//      (a subset of A's "Attributed") / Likely Meta ad (may have NO
//      campaign id - NOT campaign-attributed) / Direct-organic WhatsApp /
//      No attribution evidence.
//
// The two do not have to sum to the same buckets and the UI says so.

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
  const breakdown = useRevenueBreakdown(canSeeRevenue ? workspaceId : null, range);

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
    !breakdown.isLoading &&
    breakdown.source.length === 0;

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
          <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            “Recorded revenue” sums every revenue event (sale, payment, contracted value, adjustments, refunds) — the same figure used elsewhere in Analytics. Separating contracted value from cash payments is planned for a later change.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <RevenueBreakdownSection
              title="Revenue by attribution evidence"
              description="How strong the attribution evidence is. “Confirmed Meta campaign” is a subset of “Attributed to a known campaign” above; “Likely Meta ad” means a paid referral was seen but not matched to a campaign — it is not counted as campaign-attributed."
              rows={breakdown.source}
              isLoading={breakdown.isLoading}
              isError={breakdown.isError}
              workspaceCurrency={workspaceCurrency}
              emptyHint="Recorded revenue will be classified here by its attribution evidence."
            />
            <RevenueBreakdownSection
              title="Revenue by conversation handling"
              description="Whether the originating WhatsApp conversation shows AI handling, human handling, both, or neither conclusively."
              rows={breakdown.assist}
              isLoading={breakdown.isLoading}
              isError={breakdown.isError}
              workspaceCurrency={workspaceCurrency}
              emptyHint="Revenue linked to a WhatsApp conversation is split by who handled it."
            />
          </div>

          <RevenueBreakdownSection
            title="Revenue over time"
            description="Daily recorded revenue for the selected range."
            rows={breakdown.day}
            isLoading={breakdown.isLoading}
            isError={breakdown.isError}
            workspaceCurrency={workspaceCurrency}
            emptyHint="Days with recorded revenue will appear here."
          />

          <div>
            <h2 className="mb-1 text-sm font-semibold">Revenue by campaign</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Per-campaign spend, funnel counts, cost-per-lead, revenue and ROAS under the selected attribution model — the same model-credited figures as the Campaign Journey.
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
