import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Overview from "./Overview";

const mocks = vi.hoisted(() => ({
  integrations: [] as Array<Record<string, unknown>>,
  campaigns: [] as Array<Record<string, unknown>>,
  conversations: [] as Array<Record<string, unknown>>,
  activity: [
    { id: "technical", action: "campaign_connection_health_checked", created_at: "2026-08-29T08:00:00Z" },
    { id: "history", action: "meta_connected", created_at: "2026-08-29T07:00:00Z" },
    { id: "business", action: "lead_created", created_at: "2026-08-29T06:00:00Z" },
  ],
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "workspace-1", currentMembership: { workspace: { name: "Acapolite" } }, hasPermission: () => true }) }));
vi.mock("@/hooks/useWorkspaceActivity", () => ({ useWorkspaceActivity: () => ({ data: mocks.activity, isLoading: false, isError: false }) }));
vi.mock("@/hooks/useWorkspaceTimezone", () => ({ useWorkspaceTimezone: () => "UTC" }));
vi.mock("@/hooks/useWorkspaceCurrency", () => ({ useWorkspaceCurrency: () => "ZAR" }));
vi.mock("@/hooks/useIntegrations", () => ({ useWorkspaceIntegrations: () => ({ data: mocks.integrations }) }));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalyticsKpis: () => ({
    data: { spend: [], conversations: 0, leads: 0, qualified_leads: 0, opportunities: 0, customers: 0, revenue_total: [], revenue_attributed: [], revenue_unattributed: [] },
    isError: false,
  }),
  useCampaignPerformance: () => ({ data: mocks.campaigns, isLoading: false }),
}));
vi.mock("@/hooks/useInboxConversations", () => ({ useInboxConversations: () => ({ data: mocks.conversations, isLoading: false }) }));
vi.mock("@/hooks/useNeedsAttention", () => ({ useNeedsAttention: () => ({ data: [], isLoading: false, isError: false }) }));
vi.mock("@/hooks/useOnboardingStatus", () => ({ useOnboardingStatus: () => ({ data: { members: 1 } }) }));
vi.mock("@/components/dashboard/OnboardingChecklist", () => ({ OnboardingChecklist: () => <div>COMPACT SETUP</div> }));
vi.mock("@/lib/onboarding", () => ({
  computeOnboardingItems: () => [{ complete: false }], onboardingProgress: () => ({ completed: 0, total: 1 }),
}));

function renderOverview() {
  return render(<MemoryRouter><Overview /></MemoryRouter>);
}

describe("Dashboard operational states", () => {
  afterEach(cleanup);

  it("does not let historical connection activity establish current Meta or WhatsApp status", () => {
    mocks.integrations = [];
    mocks.campaigns = [];
    mocks.conversations = [];
    renderOverview();
    expect(screen.getByText("Meta not connected")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp not connected")).toBeInTheDocument();
    expect(screen.getByText("Meta connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Integrations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeInTheDocument();
  });

  it("uses compact, provider-aware campaign, conversation, and Flow AI empty states", () => {
    mocks.integrations = [{ provider: "meta", status: "connected" }, { provider: "whatsapp", status: "connected" }];
    mocks.campaigns = [];
    mocks.conversations = [];
    renderOverview();
    expect(screen.getByText("Launch your first campaign to see performance here.").parentElement).toHaveClass("py-8");
    expect(screen.getByText(/StabiFlow is connected and ready/).parentElement).toHaveClass("py-8");
    expect(screen.getByText(/needs campaign and conversion data/).parentElement).toHaveClass("py-8");
  });

  it("shows real campaign and conversation rows when authoritative data exists", () => {
    mocks.integrations = [{ provider: "meta", status: "connected" }, { provider: "whatsapp", status: "connected" }];
    mocks.campaigns = [{ campaign_id: "campaign-1", name: "Spring launch", currency: "ZAR", spend_minor: 12345 }];
    mocks.conversations = [{ id: "conversation-1", display_name: "Nomsa", phone_number: "+27110000000", updated_at: "2026-08-29T08:00:00Z" }];
    renderOverview();
    expect(screen.getByText("Spring launch")).toBeInTheDocument();
    expect(screen.getByText("Nomsa")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for your first conversation")).not.toBeInTheDocument();
  });

  it("filters technical health noise while keeping humanized business activity", () => {
    mocks.integrations = [];
    mocks.campaigns = [];
    mocks.conversations = [];
    renderOverview();
    expect(screen.queryByText("Campaign connection checked")).not.toBeInTheDocument();
    expect(screen.getByText("Lead created")).toBeInTheDocument();
  });
});
