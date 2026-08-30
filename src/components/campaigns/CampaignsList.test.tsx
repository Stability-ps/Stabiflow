// Production regression: clicking an existing campaign navigated to
// "/campaigns/:id" (missing the "/app" prefix) instead of the canonical
// "/app/campaigns/:id" route. Since that stale path matched nothing,
// React Router fell through to the top-level catch-all and sent an
// AUTHENTICATED user to the public landing page - looking exactly like an
// unexpected logout, even though the session/workspace were untouched.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CampaignsList } from "./CampaignsList";

const { navigateMock, state } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  state: { campaigns: [] as Array<Record<string, unknown>> },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: "workspace-1", hasPermission: () => true }),
}));
vi.mock("@/hooks/useWorkspaceTimezone", () => ({ useWorkspaceTimezone: () => "Africa/Johannesburg" }));

const mockAdAccount = { id: "acct-1", name: "StabiFlow Insights", ad_account_id: "act_123", currency: "ZAR" };
const baseCampaign = {
  id: "campaign-1", name: "Splash", objective: "OUTCOME_TRAFFIC", status: "active",
  external_campaign_id: null, last_readiness_check: null,
  budget_type: "daily", daily_budget_minor_units: 10000, lifetime_budget_minor_units: null,
  currency: "ZAR", start_at: "2026-01-01T00:00:00.000Z", end_at: null, created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  workspace_meta_ad_accounts: { name: "StabiFlow Insights", ad_account_id: "act_123" },
};

vi.mock("@/hooks/useAdCampaigns", () => ({ useAdCampaigns: () => ({ data: state.campaigns, isLoading: false }) }));
vi.mock("@/hooks/useMetaAccountResources", () => ({
  useMetaAdAccounts: () => ({ data: [mockAdAccount], isLoading: false }),
}));

function renderList() {
  return render(<MemoryRouter><CampaignsList /></MemoryRouter>);
}

describe("CampaignsList navigation", () => {
  beforeEach(() => { state.campaigns = [{ ...baseCampaign }]; });
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

describe("CampaignsList - lifecycle badge is consistent with the detail page", () => {
  beforeEach(() => { state.campaigns = [{ ...baseCampaign }]; });
  afterEach(cleanup);

  it("a published active campaign shows 'Active'", () => {
    state.campaigns = [{ ...baseCampaign, status: "active", external_campaign_id: "236xxx" }];
    renderList();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("an unpublished draft with no readiness snapshot shows 'Draft' (never 'Ready to publish' from the stored status alone)", () => {
    state.campaigns = [{ ...baseCampaign, status: "ready", external_campaign_id: null, last_readiness_check: null }];
    renderList();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("Ready to publish")).not.toBeInTheDocument();
  });

  it("a persisted FAILING readiness snapshot shows 'Needs attention' - matching what Detail would show", () => {
    state.campaigns = [{
      ...baseCampaign, status: "ready", external_campaign_id: null,
      last_readiness_check: { checked_at: "2026-08-29T10:00:00Z", ready: false, issues: [{ code: "invalid_budget", message: "start date must not be in the past", severity: "error" }] },
    }];
    renderList();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it("a persisted PASSING readiness snapshot shows 'Ready to publish'", () => {
    state.campaigns = [{
      ...baseCampaign, status: "ready", external_campaign_id: null,
      last_readiness_check: { checked_at: "2026-08-29T10:00:00Z", ready: true, issues: [] },
    }];
    renderList();
    expect(screen.getByText("Ready to publish")).toBeInTheDocument();
  });
});
