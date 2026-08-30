import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AnalyticsKpis, CampaignPerformanceRow } from "@/hooks/useAnalytics";
import type { RevenueBreakdown, RevenueBreakdownRow } from "@/hooks/useRevenueBreakdown";

const state = vi.hoisted(() => ({
  source: [] as RevenueBreakdownRow[],
  assist: [] as RevenueBreakdownRow[],
  day: [] as RevenueBreakdownRow[],
  isLoading: false,
  isError: false,
}));

vi.mock("@/hooks/useRevenueBreakdown", () => ({
  useRevenueBreakdown: (): RevenueBreakdown => ({
    source: state.source,
    assist: state.assist,
    day: state.day,
    isLoading: state.isLoading,
    isError: state.isError,
  }),
}));

import { RevenueAttributionView } from "./RevenueAttributionView";

const KPIS: AnalyticsKpis = {
  spend: [{ currency: "ZAR", amount_minor: 100_00 }],
  conversations: 10, leads: 6, qualified_leads: 3, opportunities: 2, customers: 1,
  revenue_total: [{ currency: "ZAR", amount_minor: 900_00 }],
  revenue_attributed: [{ currency: "ZAR", amount_minor: 700_00 }],
  revenue_unattributed: [{ currency: "ZAR", amount_minor: 200_00 }],
} as AnalyticsKpis;

const CAMPAIGN_ROWS: CampaignPerformanceRow[] = [
  { campaign_id: "c1", name: "Spring", status: "active", currency: "ZAR", spend_minor: 100_00, impressions: 1000, reach: 800, clicks: 50, conversations: 10, leads: 6, qualified_leads: 3, opportunities: 2, customers: 1, revenue: [{ currency: "ZAR", amount_minor: 700_00 }] },
];
const RANGE = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };

function mkRow(dimension: RevenueBreakdownRow["dimension"], key: string, label: string, minor: number, count: number): RevenueBreakdownRow {
  return { dimension, bucket_key: key, bucket_label: label, revenue: [{ currency: "ZAR", amount_minor: minor }], event_count: count };
}

function renderView(props: Partial<Parameters<typeof RevenueAttributionView>[0]> = {}) {
  return render(
    <MemoryRouter>
      <RevenueAttributionView
        workspaceId="ws-1" range={RANGE} preset="last_30_days" kpis={KPIS}
        campaignRows={CAMPAIGN_ROWS} campaignsLoading={false} canSeeRevenue workspaceCurrency="ZAR" attributionModel="last_touch"
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.source = []; state.assist = []; state.day = [];
  state.isLoading = false; state.isError = false;
});
afterEach(cleanup);

describe("RevenueAttributionView", () => {
  it("shows a permission empty state when the member cannot see revenue", () => {
    renderView({ canSeeRevenue: false });
    expect(screen.getByText(/don't have permission to view revenue/i)).toBeInTheDocument();
  });

  it("shows a 'no revenue recorded' explanation (not zeroes) when nothing is recorded and no source rows exist", () => {
    renderView({ kpis: { ...KPIS, revenue_total: [], revenue_attributed: [], revenue_unattributed: [] } as AnalyticsKpis });
    expect(screen.getByText("No revenue recorded in this range")).toBeInTheDocument();
  });

  it("separates campaign attribution (top card) from attribution evidence (breakdown), and says so (HIGH-5)", () => {
    state.source = [
      mkRow("source", "meta_direct", "Confirmed Meta campaign", 500_00, 3),
      mkRow("source", "unattributed", "No attribution evidence", 200_00, 1),
    ];
    renderView();
    // A: campaign attribution
    expect(screen.getByText("Attributed to a known campaign")).toBeInTheDocument();
    expect(screen.getByText(/Unattributed \(organic\/manual\/unknown\)/i)).toBeInTheDocument();
    // B: evidence
    expect(screen.getByText("Revenue by attribution evidence")).toBeInTheDocument();
    expect(screen.getByText("Confirmed Meta campaign")).toBeInTheDocument();
    expect(screen.getByText(/subset of .Attributed to a known campaign/i)).toBeInTheDocument();
  });

  it("renders the four conversation-handling buckets (AI only / Human only / AI + Human / Unknown)", () => {
    state.assist = [
      mkRow("assist", "ai_and_human", "AI + Human", 400_00, 2),
      mkRow("assist", "ai_only", "AI only", 300_00, 1),
      mkRow("assist", "human_only", "Human only", 200_00, 1),
      mkRow("assist", "unknown", "Unknown", 100_00, 1),
    ];
    renderView();
    expect(screen.getByText("Revenue by conversation handling")).toBeInTheDocument();
    expect(screen.getByText("AI + Human")).toBeInTheDocument();
    expect(screen.getByText("AI only")).toBeInTheDocument();
    expect(screen.getByText("Human only")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("renders over-time and by-campaign sections and states the revenue-event semantics", () => {
    state.source = [mkRow("source", "meta_direct", "Confirmed Meta campaign", 500_00, 1)];
    state.day = [mkRow("day", "2026-09-10", "2026-09-10", 300_00, 1)];
    renderView();
    expect(screen.getByText("Revenue over time")).toBeInTheDocument();
    expect(screen.getByText("Revenue by campaign")).toBeInTheDocument();
    expect(screen.getByText("Spring")).toBeInTheDocument();
    expect(screen.getByText(/sums every revenue event/i)).toBeInTheDocument();
  });
});
