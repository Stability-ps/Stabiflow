import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AnalyticsKpis, CampaignPerformanceRow } from "@/hooks/useAnalytics";
import type { RevenueBreakdownRow } from "@/hooks/useRevenueBreakdown";

const state = vi.hoisted(() => ({
  source: [] as RevenueBreakdownRow[],
  assist: [] as RevenueBreakdownRow[],
  day: [] as RevenueBreakdownRow[],
  isLoading: false,
  isError: false,
}));

vi.mock("@/hooks/useRevenueBreakdown", () => ({
  useRevenueBreakdown: (_ws: string | null, _range: unknown, dimension: "source" | "assist" | "day") => ({
    data: state[dimension],
    isLoading: state.isLoading,
    isError: state.isError,
  }),
}));

import { RevenueAttributionView } from "./RevenueAttributionView";

const KPIS: AnalyticsKpis = {
  spend: [{ currency: "ZAR", amount_minor: 100_00 }],
  conversations: 10,
  leads: 6,
  qualified_leads: 3,
  opportunities: 2,
  customers: 1,
  revenue_total: [{ currency: "ZAR", amount_minor: 900_00 }],
  revenue_attributed: [{ currency: "ZAR", amount_minor: 700_00 }],
  revenue_unattributed: [{ currency: "ZAR", amount_minor: 200_00 }],
} as AnalyticsKpis;

const CAMPAIGN_ROWS: CampaignPerformanceRow[] = [
  { campaign_id: "c1", name: "Spring", status: "active", currency: "ZAR", spend_minor: 100_00, impressions: 1000, reach: 800, clicks: 50, conversations: 10, leads: 6, qualified_leads: 3, opportunities: 2, customers: 1, revenue: [{ currency: "ZAR", amount_minor: 700_00 }] },
];

const RANGE = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };

function renderView(props: Partial<Parameters<typeof RevenueAttributionView>[0]> = {}) {
  return render(
    <MemoryRouter>
      <RevenueAttributionView
        workspaceId="ws-1"
        range={RANGE}
        preset="last_30_days"
        kpis={KPIS}
        campaignRows={CAMPAIGN_ROWS}
        campaignsLoading={false}
        canSeeRevenue
        workspaceCurrency="ZAR"
        attributionModel="last_touch"
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.source = [];
  state.assist = [];
  state.day = [];
  state.isLoading = false;
  state.isError = false;
});
afterEach(cleanup);

describe("RevenueAttributionView", () => {
  it("shows a permission empty state when the member cannot see revenue", () => {
    renderView({ canSeeRevenue: false });
    expect(screen.getByText(/don't have permission to view revenue/i)).toBeInTheDocument();
  });

  it("shows a 'no revenue recorded' explanation (not zeroes) when nothing is recorded and no source rows exist", () => {
    renderView({
      kpis: { ...KPIS, revenue_total: [], revenue_attributed: [], revenue_unattributed: [] } as AnalyticsKpis,
    });
    expect(screen.getByText("No revenue recorded in this range")).toBeInTheDocument();
  });

  it("renders the source, assist, over-time and by-campaign breakdowns from real rows", () => {
    state.source = [
      { bucket_key: "meta_direct", bucket_label: "Meta ad — direct match", revenue: [{ currency: "ZAR", amount_minor: 500_00 }], event_count: 3 },
      { bucket_key: "unattributed", bucket_label: "Unattributed (manual / unknown)", revenue: [{ currency: "ZAR", amount_minor: 200_00 }], event_count: 1 },
    ];
    state.assist = [
      { bucket_key: "ai_assisted", bucket_label: "AI-assisted journey", revenue: [{ currency: "ZAR", amount_minor: 400_00 }], event_count: 2 },
    ];
    state.day = [
      { bucket_key: "2026-09-10", bucket_label: "2026-09-10", revenue: [{ currency: "ZAR", amount_minor: 300_00 }], event_count: 1 },
    ];
    renderView();
    expect(screen.getByText("Revenue by source")).toBeInTheDocument();
    expect(screen.getByText("Meta ad — direct match")).toBeInTheDocument();
    expect(screen.getByText("AI-assisted vs human-assisted")).toBeInTheDocument();
    expect(screen.getByText("AI-assisted journey")).toBeInTheDocument();
    expect(screen.getByText("Revenue over time")).toBeInTheDocument();
    expect(screen.getByText("Revenue by campaign")).toBeInTheDocument();
    // the campaign row links into the campaign
    expect(screen.getByText("Spring")).toBeInTheDocument();
  });

  it("keeps the attributed / unattributed split visible (from get_analytics_kpis, honest labels)", () => {
    state.source = [{ bucket_key: "meta_direct", bucket_label: "Meta ad — direct match", revenue: [{ currency: "ZAR", amount_minor: 500_00 }], event_count: 1 }];
    renderView();
    expect(screen.getByText("Attributed to a known campaign")).toBeInTheDocument();
    expect(screen.getByText(/Unattributed \(organic\/manual\/unknown\)/i)).toBeInTheDocument();
  });
});
