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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentWorkspaceId: "workspace-1",
    currentMembership: { workspace: { name: "Acapolite" } },
    user: { id: "user-1" },
    profile: { full_name: "Pat Test" },
    hasPermission: () => true,
  }),
}));
vi.mock("@/hooks/useFeatureFlags", () => ({ useFeatureFlags: () => ({ isEnabled: () => true, isLoading: false, hasAdvancedModules: true }) }));
vi.mock("@/hooks/useDashboardPreferences", () => ({
  useDashboardPreferences: () => ({ data: null, isLoading: false }),
  useSaveDashboardPreferences: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useWorkspaceActivity", () => ({ useWorkspaceActivity: () => ({ data: mocks.activity, isLoading: false, isError: false }) }));
vi.mock("@/hooks/useWorkspaceTimezone", () => ({ useWorkspaceTimezone: () => "UTC" }));
vi.mock("@/hooks/useWorkspaceCurrency", () => ({ useWorkspaceCurrency: () => "ZAR" }));
vi.mock("@/hooks/useIntegrations", () => ({ useWorkspaceIntegrations: () => ({ data: mocks.integrations }) }));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalyticsKpis: () => ({
    data: { spend: [], conversations: 0, leads: 0, qualified_leads: 0, opportunities: 0, customers: 0, revenue_total: [], revenue_attributed: [], revenue_unattributed: [] },
    isError: false,
  }),
  useCampaignPerformance: () => ({ data: mocks.campaigns, isLoading: false, isError: false, refetch: vi.fn() }),
  useLeadSourceBreakdown: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useWhatsAppAnalytics: () => ({ data: { conversations_started: 0, became_leads: 0, became_qualified: 0, became_customers: 0 }, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useInboxConversations", () => ({ useInboxConversations: () => ({ data: mocks.conversations, isLoading: false }) }));
vi.mock("@/hooks/useNeedsAttention", () => ({ useNeedsAttention: () => ({ items: [], isLoading: false, partialFailure: false }) }));
vi.mock("@/hooks/useAutomations", () => ({ useAutomations: () => ({ data: [], isError: false }) }));
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
    // Both the Conversations metric and the WhatsApp activity chart show
    // this when disconnected - two distinct widgets, same honest message.
    expect(screen.getAllByText("WhatsApp not connected").length).toBeGreaterThan(0);
    // From the mocked activity feed's "meta_connected" row (Recent activity
    // widget), never from current connection status.
    expect(screen.getByText("Meta connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Integrations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeInTheDocument();
  });

  it("uses compact, provider-aware campaign and conversation empty states", () => {
    mocks.integrations = [{ provider: "meta", status: "connected" }, { provider: "whatsapp", status: "connected" }];
    mocks.campaigns = [];
    mocks.conversations = [];
    renderOverview();
    expect(screen.getByText("Launch your first campaign to see performance here.")).toBeInTheDocument();
    expect(screen.getByText(/New WhatsApp messages will appear here automatically/)).toBeInTheDocument();
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

  it("greets the signed-in user by first name and shows their workspace", () => {
    mocks.integrations = [];
    mocks.campaigns = [];
    mocks.conversations = [];
    renderOverview();
    expect(screen.getByRole("heading", { name: /Pat$/ })).toBeInTheDocument();
    expect(screen.getByText("Acapolite")).toBeInTheDocument();
  });

  it("exposes a Customize dashboard action", () => {
    mocks.integrations = [];
    mocks.campaigns = [];
    mocks.conversations = [];
    renderOverview();
    expect(screen.getByRole("button", { name: /Customize dashboard/ })).toBeInTheDocument();
  });
});
