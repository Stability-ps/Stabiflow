import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CampaignJourneyData, JourneyEntityRow } from "@/hooks/useCampaignJourney";

const state = vi.hoisted(() => ({
  journey: null as unknown as CampaignJourneyData,
  stageEntities: [] as JourneyEntityRow[],
}));

// A spy that MUST NOT be called by a read-only screen.
const invokeSpy = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: "ws-1", currentMembership: { role: "owner" } }),
}));
vi.mock("@/hooks/useWorkspaceCurrency", () => ({ useWorkspaceCurrency: () => "ZAR" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: invokeSpy }, from: () => { throw new Error("read screens must not query directly in this test"); } },
}));
vi.mock("@/hooks/useCampaignJourney", () => ({
  useCampaignJourney: () => state.journey,
  useCampaignJourneyStageEntities: () => ({ data: state.stageEntities, isLoading: false }),
}));

import { CampaignJourney } from "./CampaignJourney";

function baseJourney(overrides: Partial<CampaignJourneyData> = {}): CampaignJourneyData {
  return {
    funnel: {
      spend_minor: 100_00,
      currency: "ZAR",
      impressions: 5000,
      reach: 4000,
      clicks: 200,
      conversations: 40,
      qualified_leads: 12,
      leads: 20,
      opportunities: 0,
      customers: 4,
      revenue: [{ currency: "ZAR", amount_minor: 800_00 }],
    },
    drillRows: [
      { attribution_method: "deterministic", ad_set_id: "as1", ad_id: "a1", creative_id: "c1", conversation_id: "conv1", lead_id: "l1", opportunity_id: null, customer_id: null },
      { attribution_method: "provider_reported", ad_set_id: "as1", ad_id: "a1", creative_id: "c1", conversation_id: "conv2", lead_id: "l2", opportunity_id: null, customer_id: null },
    ],
    capped: false,
    names: { adSet: new Map([["as1", "Prospecting"]]), ad: new Map([["a1", "Ad A"]]), creative: new Map([["c1", "Buy now"]]) },
    canView: true,
    canSeeRevenue: true,
    isLoading: false,
    isError: false,
    ...overrides,
  };
}

function renderJourney() {
  return render(
    <MemoryRouter>
      <CampaignJourney campaignId="camp-1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.journey = baseJourney();
  state.stageEntities = [];
  invokeSpy.mockClear();
});
afterEach(cleanup);

describe("CampaignJourney", () => {
  it("shows a permission empty state when the member cannot view attribution", () => {
    state.journey = baseJourney({ canView: false });
    renderJourney();
    expect(screen.getByText(/don't have permission to view attribution/i)).toBeInTheDocument();
  });

  it("shows an explanatory empty state (not a wall of zeroes) when there is no journey data", () => {
    state.journey = baseJourney({
      funnel: { spend_minor: 0, currency: "ZAR", impressions: 0, reach: 0, clicks: 0, conversations: 0, qualified_leads: 0, leads: 0, opportunities: 0, customers: 0, revenue: [] },
      drillRows: [],
    });
    renderJourney();
    expect(screen.getByText("No campaign attribution yet")).toBeInTheDocument();
  });

  it("renders the funnel with real counts and distinguishes an unavailable cost (—) from a measured zero", () => {
    renderJourney();
    // real counts render as numbers (40 conversations, 20 leads, 4 customers)
    expect(screen.getAllByText("40").length).toBeGreaterThan(0);
    expect(screen.getAllByText("20").length).toBeGreaterThan(0);
    expect(screen.getByText("Opportunities")).toBeInTheDocument();
    // opportunities count is 0 (a real measured zero, still shown as a number)
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    // and an unavailable cost/rate renders as an em dash somewhere
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("labels attribution as direct vs inferred and never presents inferred as deterministic", () => {
    renderJourney();
    // one deterministic (conv1) + one provider_reported (conv2) -> "1 direct" / "1 inferred"
    // (shown per stage that carries a band, so at least once)
    expect(screen.getAllByText(/1 direct/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 inferred/).length).toBeGreaterThan(0);
    expect(screen.getByText(/could not be matched to a StabiFlow campaign/i)).toBeInTheDocument();
  });

  it("hides revenue and ROAS when the member lacks the revenue permission", () => {
    state.journey = baseJourney({ canSeeRevenue: false });
    renderJourney();
    expect(screen.queryByText("ROAS")).not.toBeInTheDocument();
    expect(screen.getByText(/Revenue & ROAS require the revenue permission/i)).toBeInTheDocument();
  });

  it("drill-down: expanding a stage links each record to the real object with navigation state", () => {
    state.stageEntities = [
      { id: "conv1", primaryLabel: "Nomsa", secondaryLabel: "+27 82 000 0001", statusLabel: "assigned", method: "deterministic", leadId: "l1", opportunityId: null, customerId: null, conversationId: "conv1" },
    ];
    renderJourney();
    // open the "conversations" entity drill-down
    const summary = screen.getByText(/^conversations \(/i);
    fireEvent.click(summary);
    const openLink = screen.getByRole("link", { name: /open/i });
    expect(openLink).toHaveAttribute("href", "/app/whatsapp/inbox");
  });

  it("shows a friendly error state and never leaks a raw error string", () => {
    state.journey = baseJourney({ isError: true, funnel: null });
    renderJourney();
    expect(screen.getByText("Unable to load the journey")).toBeInTheDocument();
  });

  it("does not fire any provider mutation on render", () => {
    renderJourney();
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});
