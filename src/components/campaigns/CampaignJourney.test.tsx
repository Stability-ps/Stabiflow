import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CampaignJourneyData, JourneyEntityRow } from "@/hooks/useCampaignJourney";
import type { CampaignJourneyRow } from "@/lib/campaignJourney";

const state = vi.hoisted(() => ({
  journey: null as unknown as CampaignJourneyData,
  entities: [] as JourneyEntityRow[],
  entityTotalSeen: 0,
}));
const invokeSpy = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: "ws-1", currentMembership: { role: "owner" } }),
}));
vi.mock("@/hooks/useWorkspaceCurrency", () => ({ useWorkspaceCurrency: () => "ZAR" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: invokeSpy }, from: () => { throw new Error("read screens must not query tables directly here"); }, rpc: () => { throw new Error("no rpc in this unit test"); } },
}));
vi.mock("@/hooks/useCampaignJourney", async (orig) => {
  const actual = await orig<typeof import("@/hooks/useCampaignJourney")>();
  return {
    ...actual,
    useCampaignJourney: () => state.journey,
    useCampaignJourneyNames: () => ({ data: { adSet: new Map([["as1", "Prospecting"]]), ad: new Map(), creative: new Map() } }),
    useCampaignJourneyStageEntities: (_ws: unknown, _c: unknown, _stage: unknown, _m: unknown, _page: unknown, enabled: boolean) => ({
      data: enabled ? state.entities : undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
    }),
  };
});

import { CampaignJourney } from "./CampaignJourney";

function baseRow(overrides: Partial<CampaignJourneyRow> = {}): CampaignJourneyRow {
  return {
    campaign_id: "camp-1", name: "Spring", status: "active", currency: "ZAR",
    metrics_available: true,
    spend_minor: 100_00, impressions: 5000, reach: 4000, clicks: 200,
    conversations: 40, conversations_direct: 30, conversations_inferred: 10,
    leads: 20, leads_direct: 14, leads_inferred: 6,
    qualified_leads: 12,
    opportunities: 3, opportunities_direct: 2, opportunities_inferred: 1,
    customers: 4, customers_direct: 3, customers_inferred: 1,
    revenue: [{ currency: "ZAR", amount_minor: 800_00 }],
    adset_breakdown: [{ id: "as1", conversations: 25, leads: 12, opportunities: 2, customers: 2 }],
    ad_breakdown: [],
    creative_breakdown: [],
    ...overrides,
  };
}
function journey(overrides: Partial<CampaignJourneyData> = {}): CampaignJourneyData {
  return { row: baseRow(), canView: true, canSeeRevenue: true, isLoading: false, isError: false, ...overrides };
}

function renderJourney() {
  return render(<MemoryRouter><CampaignJourney campaignId="camp-1" /></MemoryRouter>);
}

beforeEach(() => {
  state.journey = journey();
  state.entities = [];
  invokeSpy.mockClear();
});
afterEach(cleanup);

describe("CampaignJourney", () => {
  it("shows a permission empty state when the member cannot view attribution", () => {
    state.journey = journey({ canView: false });
    renderJourney();
    expect(screen.getByText(/don't have permission to view attribution/i)).toBeInTheDocument();
  });

  it("shows an explanatory empty state (not zeroes) when there is no journey data", () => {
    state.journey = journey({ row: baseRow({ metrics_available: false, spend_minor: 0, clicks: 0, conversations: 0, conversations_direct: 0, conversations_inferred: 0, leads: 0, leads_direct: 0, leads_inferred: 0, qualified_leads: 0, opportunities: 0, opportunities_direct: 0, opportunities_inferred: 0, customers: 0, customers_direct: 0, customers_inferred: 0, revenue: [], adset_breakdown: [] }) });
    renderJourney();
    expect(screen.getByText("No campaign attribution yet")).toBeInTheDocument();
  });

  it("renders 'Not synced yet' (never 0) for Spend/Clicks/ROAS when Meta metrics have never synced (HIGH-4)", () => {
    state.journey = journey({ row: baseRow({ metrics_available: false, spend_minor: 0, clicks: 0 }) });
    renderJourney();
    expect(screen.getAllByText("Not synced yet").length).toBeGreaterThan(0);
    expect(screen.getByText(/Meta has not synced ad metrics/i)).toBeInTheDocument();
    // conversion counts are still real
    expect(screen.getAllByText("40").length).toBeGreaterThan(0);
  });

  it("shows a real measured 0 (R0.00) when metrics exist but spend is zero", () => {
    state.journey = journey({ row: baseRow({ metrics_available: true, spend_minor: 0 }) });
    renderJourney();
    expect(screen.queryByText("Not synced yet")).not.toBeInTheDocument();
    expect(screen.getAllByText(/R0[.,]00|R 0[.,]00|ZAR 0\.00/).length).toBeGreaterThan(0);
  });

  it("the funnel is ordered Conversations -> Leads -> Qualified -> Opportunities -> Customers", () => {
    renderJourney();
    const funnelCard = screen.getByText(/^Funnel \(/).closest("[class*='rounded']") as HTMLElement;
    const labels = within(funnelCard).getAllByText(/^(Clicks|Conversations|Leads|Qualified|Opportunities|Customers)$/).map((n) => n.textContent);
    expect(labels).toEqual(["Clicks", "Conversations", "Leads", "Qualified", "Opportunities", "Customers"]);
  });

  it("labels attribution direct vs inferred and never presents inferred as deterministic", () => {
    renderJourney();
    expect(screen.getAllByText(/\d+ direct/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\d+ inferred/).length).toBeGreaterThan(0);
    expect(screen.getByText(/could not be matched to a StabiFlow campaign/i)).toBeInTheDocument();
    expect(screen.getByText(/Direct \+ Inferred always equals the stage total/i)).toBeInTheDocument();
  });

  it("the drill-down stage count matches the funnel count (single population — HIGH-1)", () => {
    renderJourney();
    // funnel Leads column shows 20; the drill-down <summary> also says "Leads (20)"
    expect(screen.getByRole("button", { name: /Leads \(20\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Customers \(4\)/ })).toBeInTheDocument();
  });

  it("hides revenue and ROAS without the revenue permission", () => {
    state.journey = journey({ canSeeRevenue: false });
    renderJourney();
    expect(screen.queryByText("ROAS")).not.toBeInTheDocument();
    expect(screen.getByText(/Revenue & ROAS require the revenue permission/i)).toBeInTheDocument();
  });

  it("drill-down: expanding a stage lists real records with a correct deep link", () => {
    state.entities = [
      { entity_id: "l1", primary_label: "LEAD-000001", secondary_label: "Nomsa", status_label: "qualified / active", occurred_at: "2026-09-01T10:00:00Z", attribution_method: "deterministic", attribution_confidence: "exact", lead_id: "l1", opportunity_id: null, customer_id: null, conversation_id: "conv1" },
    ];
    renderJourney();
    fireEvent.click(screen.getByRole("button", { name: /Leads \(20\)/ }));
    const openLink = screen.getByRole("link", { name: /Open lead/i });
    expect(openLink).toHaveAttribute("href", "/app/leads");
  });

  it("customer drill link is honest: 'Open related lead', not a dead 'Open customer'", () => {
    state.entities = [
      { entity_id: "cu1", primary_label: "Acme", secondary_label: null, status_label: "customer", occurred_at: "2026-09-01T10:00:00Z", attribution_method: "deterministic", attribution_confidence: "exact", lead_id: "l9", opportunity_id: "o9", customer_id: "cu1", conversation_id: null },
    ];
    renderJourney();
    fireEvent.click(screen.getByRole("button", { name: /Customers \(4\)/ }));
    expect(screen.getByRole("link", { name: /Open related lead/i })).toHaveAttribute("href", "/app/leads");
    expect(screen.queryByRole("link", { name: /Open customer/i })).not.toBeInTheDocument();
  });

  it("shows pagination controls when a stage has more than one page of records", () => {
    state.entities = Array.from({ length: 25 }, (_, i) => ({
      entity_id: `l${i}`, primary_label: `LEAD-${i}`, secondary_label: null, status_label: null,
      occurred_at: "2026-09-01T10:00:00Z", attribution_method: "deterministic", attribution_confidence: "exact",
      lead_id: `l${i}`, opportunity_id: null, customer_id: null, conversation_id: null,
    }));
    renderJourney(); // Leads total = 20 -> 1 page; Conversations total = 40 -> 2 pages
    fireEvent.click(screen.getByRole("button", { name: /Conversations \(40\)/ }));
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByText(/of 40/)).toBeInTheDocument();
  });

  it("shows a friendly error state and never leaks a raw error string", () => {
    state.journey = journey({ isError: true, row: null });
    renderJourney();
    expect(screen.getByText("Unable to load the journey")).toBeInTheDocument();
  });

  it("does not fire any provider mutation on render", () => {
    renderJourney();
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});
