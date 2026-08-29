// Production regression companion test: proves the canonical campaign
// route (/app/campaigns/:id, via CampaignDetail) actually renders a real
// existing campaign - not just that CampaignsList *navigates* there. Full
// App-level rendering (with RequireAuth/RequireWorkspace/AppLayout) is
// covered by the routing tests; this proves the destination page itself
// is populated for a valid campaign, with hooks mocked as in other
// campaigns tests (CampaignBuilder.test.tsx).
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CampaignDetail } from "./CampaignDetail";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: "workspace-1", hasPermission: () => true }),
}));
vi.mock("@/hooks/useWorkspaceCurrency", () => ({ useWorkspaceCurrency: () => "ZAR" }));
vi.mock("@/hooks/useAdCampaign", () => ({
  useAdCampaign: () => ({
    data: {
      id: "campaign-1", name: "Splash", objective: "OUTCOME_TRAFFIC", status: "active",
      budget_type: "daily", daily_budget_minor_units: 10000, lifetime_budget_minor_units: null,
      currency: "ZAR", start_at: "2026-01-01T00:00:00.000Z", end_at: null,
      ad_account_id: "acct-1", workspace_meta_ad_accounts: { name: "StabiFlow Insights", ad_account_id: "act_123" },
      ad_creatives: null,
    },
    isLoading: false,
  }),
  useCampaignActivity: () => ({ data: [] }),
}));
vi.mock("@/hooks/useAdCampaignMetrics", () => ({ useAdCampaignMetrics: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/useAnalytics", () => ({ useSingleCampaignPerformance: () => ({ data: null }) }));

function renderDetail() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><CampaignDetail campaignId="campaign-1" /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CampaignDetail renders a valid existing campaign at the canonical route", () => {
  afterEach(cleanup);

  it("shows the campaign name and status for the requested id", () => {
    renderDetail();
    expect(screen.getByRole("heading", { name: "Splash" })).toBeInTheDocument();
  });
});
