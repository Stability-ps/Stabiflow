// Production regression: clicking an existing campaign navigated to
// "/campaigns/:id" (missing the "/app" prefix) instead of the canonical
// "/app/campaigns/:id" route. Since that stale path matched nothing,
// React Router fell through to the top-level catch-all and sent an
// AUTHENTICATED user to the public landing page - looking exactly like an
// unexpected logout, even though the session/workspace were untouched.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CampaignsList } from "./CampaignsList";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: "workspace-1", hasPermission: () => true }),
}));

const mockAdAccount = { id: "acct-1", name: "StabiFlow Insights", ad_account_id: "act_123", currency: "ZAR" };
const mockCampaign = {
  id: "campaign-1", name: "Splash", objective: "OUTCOME_TRAFFIC", status: "active",
  budget_type: "daily", daily_budget_minor_units: 10000, lifetime_budget_minor_units: null,
  currency: "ZAR", start_at: "2026-01-01T00:00:00.000Z", end_at: null,
  workspace_meta_ad_accounts: { name: "StabiFlow Insights", ad_account_id: "act_123" },
};

vi.mock("@/hooks/useAdCampaigns", () => ({ useAdCampaigns: () => ({ data: [mockCampaign], isLoading: false }) }));
vi.mock("@/hooks/useMetaAccountResources", () => ({
  useMetaAdAccounts: () => ({ data: [mockAdAccount], isLoading: false }),
}));

function renderList() {
  return render(<MemoryRouter><CampaignsList /></MemoryRouter>);
}

describe("CampaignsList navigation", () => {
  afterEach(() => {
    cleanup();
    navigateMock.mockReset();
  });

  it("REGRESSION: clicking an existing campaign navigates to the canonical /app/campaigns/:id route, not the stale /campaigns/:id", () => {
    renderList();
    fireEvent.click(screen.getByText("Splash"));
    expect(navigateMock).toHaveBeenCalledWith("/app/campaigns/campaign-1");
    expect(navigateMock).not.toHaveBeenCalledWith("/campaigns/campaign-1");
  });

  it("New Campaign and other actions also use canonical /app routes", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /New Campaign/i }));
    expect(navigateMock).toHaveBeenCalledWith("/app/campaigns/new");
  });
});
