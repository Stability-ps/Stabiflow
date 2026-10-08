// Production regression: clicking an existing campaign navigated to
// "/campaigns/:id" (missing the "/app" prefix) instead of the canonical
// "/app/campaigns/:id" route. Since that stale path matched nothing,
// React Router fell through to the top-level catch-all and sent an
// AUTHENTICATED user to the public landing page - looking exactly like an
// unexpected logout, even though the session/workspace were untouched.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CampaignsList } from "./CampaignsList";

const { navigateMock, state } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  state: {
    campaigns: [] as Array<Record<string, unknown>>,
    campaignsError: false,
    adAccounts: [] as Array<Record<string, unknown>>,
    adAccountsError: false,
  },
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

vi.mock("@/hooks/useAdCampaigns", () => ({
  useAdCampaigns: () => (state.campaignsError
    ? { data: undefined, isLoading: false, isError: true, refetch: vi.fn() }
    : { data: state.campaigns, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useMetaAccountResources", () => ({
  useMetaAdAccounts: () => (state.adAccountsError
    ? { data: undefined, isLoading: false, isError: true, refetch: vi.fn() }
    : { data: state.adAccounts, isLoading: false, isError: false, refetch: vi.fn() }),
}));

function renderList() {
  return render(<MemoryRouter><CampaignsList /></MemoryRouter>);
}

function reset() {
  state.campaigns = [{ ...baseCampaign }];
  state.campaignsError = false;
  state.adAccounts = [mockAdAccount];
  state.adAccountsError = false;
}

describe("CampaignsList navigation", () => {
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    navigateMock.mockReset();
  });

  it("REGRESSION: an existing campaign links to the canonical /app/campaigns/:id route, not the stale /campaigns/:id", () => {
    renderList();
    const link = screen.getByRole("link", { name: /Splash/ });
    expect(link).toHaveAttribute("href", "/app/campaigns/campaign-1");
  });

  it("New campaign also uses the canonical /app route", () => {
    renderList();
    expect(screen.getByRole("link", { name: /New campaign/i })).toHaveAttribute("href", "/app/campaigns/new");
  });
});

describe("CampaignsList - honest empty and error states", () => {
  beforeEach(reset);
  afterEach(cleanup);

  it("a campaigns load error shows a retry state, never 'No campaigns yet' or 'connect an ad account'", () => {
    state.campaignsError = true;
    renderList();
    expect(screen.getByText("Couldn't load campaigns")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No campaigns yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/Connect a Meta ad account/)).not.toBeInTheDocument();
  });

  it("no campaigns and no ad account asks to connect one", () => {
    state.campaigns = [];
    state.adAccounts = [];
    renderList();
    expect(screen.getByText("Connect a Meta ad account")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Integrations" })).toHaveAttribute("href", "/app/integrations");
  });

  it("no campaigns with a connected account offers New campaign", () => {
    state.campaigns = [];
    renderList();
    expect(screen.getByText("No campaigns yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New campaign/i })).toBeInTheDocument();
  });

  it("existing campaigns stay visible when the ad account is disconnected, with a reconnect notice", () => {
    state.adAccounts = [];
    renderList();
    expect(screen.getByRole("link", { name: /Splash/ })).toBeInTheDocument();
    expect(screen.getByText(/No Meta ad account is connected/)).toBeInTheDocument();
  });

  it("an ad-account lookup error is not reported as 'not connected'", () => {
    state.adAccountsError = true;
    renderList();
    expect(screen.getByRole("link", { name: /Splash/ })).toBeInTheDocument();
    expect(screen.getByText(/couldn't check your Meta ad account/i)).toBeInTheDocument();
    expect(screen.queryByText(/No Meta ad account is connected/)).not.toBeInTheDocument();
  });

  it("summarises running and attention counts in the header and tiles", () => {
    state.campaigns = [
      { ...baseCampaign, id: "a", status: "active", external_campaign_id: "1" },
      { ...baseCampaign, id: "b", name: "Broken", status: "failed", external_campaign_id: null },
    ];
    renderList();
    expect(screen.getByText(/1 running · 1 needs attention/)).toBeInTheDocument();
  });
});

describe("CampaignsList - lifecycle badge is consistent with the detail page", () => {
  beforeEach(reset);
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

  it("HIGH-1: after an edit (status back to 'draft', last_readiness_check cleared) the list shows 'Draft', NOT the pre-edit 'Ready to publish'", () => {
    // This is the exact post-updateCampaignDraft row shape: an edit resets
    // status to 'draft' AND nulls last_readiness_check, so the stale
    // passing result can no longer leak through.
    state.campaigns = [{ ...baseCampaign, status: "draft", external_campaign_id: null, last_readiness_check: null }];
    renderList();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("Ready to publish")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });
});
