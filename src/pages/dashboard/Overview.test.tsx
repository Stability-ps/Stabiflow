import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Overview from "./Overview";

const EMPTY_KPIS = { spend: [], conversations: 0, leads: 0, qualified_leads: 0, opportunities: 0, customers: 0, revenue_total: [], revenue_attributed: [], revenue_unattributed: [] };

const mocks = vi.hoisted(() => ({
  integrations: [] as Array<Record<string, unknown>>,
  campaigns: [] as Array<Record<string, unknown>>,
  conversations: [] as Array<Record<string, unknown>>,
  kpis: null as Record<string, unknown> | null,
  kpisError: false,
  enabled: new Set<string>(),
  locked: new Set<string>(),
  permissions: new Set<string>(),
  attention: [] as Array<Record<string, unknown>>,
  activity: [
    { id: "technical", action: "campaign_connection_health_checked", created_at: "2026-08-29T08:00:00Z" },
    { id: "history", action: "meta_connected", created_at: "2026-08-29T07:00:00Z" },
    { id: "business", action: "lead_created", created_at: "2026-08-29T06:00:00Z" },
  ],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentWorkspaceId: "workspace-1",
    currentMembership: { role: "owner", workspace: { name: "Ubuntu Bakery" } },
    profile: { full_name: "Thandi Mokoena" },
    hasPermission: (p: string) => mocks.permissions.has(p),
  }),
}));
vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: (k: string) => mocks.enabled.has(k), isPlanLocked: (k: string) => mocks.locked.has(k), isLoading: false, hasAdvancedModules: true }),
}));
vi.mock("@/hooks/useWorkspaceActivity", () => ({ useWorkspaceActivity: () => ({ data: mocks.activity, isLoading: false, isError: false }) }));
vi.mock("@/hooks/useWorkspaceTimezone", () => ({ useWorkspaceTimezone: () => "UTC" }));
vi.mock("@/hooks/useWorkspaceCurrency", () => ({ useWorkspaceCurrency: () => "ZAR" }));
vi.mock("@/hooks/useIntegrations", () => ({ useWorkspaceIntegrations: () => ({ data: mocks.integrations }) }));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalyticsKpis: () => ({ data: mocks.kpis ?? undefined, isError: mocks.kpisError }),
  useCampaignPerformance: () => ({ data: mocks.campaigns, isLoading: false }),
}));
vi.mock("@/hooks/useInboxConversations", () => ({ useInboxConversations: () => ({ data: mocks.conversations, isLoading: false }) }));
vi.mock("@/hooks/useNeedsAttention", () => ({ useNeedsAttention: () => ({ items: mocks.attention, isLoading: false, partialFailure: false }) }));
vi.mock("@/hooks/useOnboardingStatus", () => ({ useOnboardingStatus: () => ({ data: { members: 1 } }) }));
vi.mock("@/components/dashboard/OnboardingChecklist", () => ({ OnboardingChecklist: () => <div>COMPACT SETUP</div> }));
vi.mock("@/lib/onboarding", () => ({
  computeOnboardingItems: () => [{ complete: false }], onboardingProgress: () => ({ completed: 0, total: 1 }),
}));

const ALL_MODULES = ["module.content", "module.campaigns", "module.creative_studio", "module.whatsapp", "module.leads", "module.customers", "module.analytics", "module.flow_ai", "module.automations", "module.integrations"];

function renderOverview() {
  return render(<MemoryRouter><Overview /></MemoryRouter>);
}

const tile = (label: string) => {
  const el = screen.getByText(label, { selector: "p" }).closest("[data-metric-state]");
  if (!el) throw new Error(`no metric tile for ${label}`);
  return el as HTMLElement;
};

beforeEach(() => {
  mocks.integrations = [];
  mocks.campaigns = [];
  mocks.conversations = [];
  mocks.kpis = { ...EMPTY_KPIS };
  mocks.kpisError = false;
  mocks.enabled = new Set(ALL_MODULES);
  mocks.locked = new Set();
  mocks.permissions = new Set(["view_analytics", "revenue.view", "lead.create", "content.create", "campaign.create"]);
  mocks.attention = [];
});
afterEach(cleanup);

describe("Home header", () => {
  it("greets the person by first name and summarises what needs them", () => {
    mocks.attention = [{ id: "a" }, { id: "b" }];
    renderOverview();
    expect(screen.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Thandi$/ })).toBeInTheDocument();
    expect(screen.getByText("2 things need you across Ubuntu Bakery.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("says when nothing needs attention", () => {
    renderOverview();
    expect(screen.getByText("Nothing needs you right now across Ubuntu Bakery.")).toBeInTheDocument();
  });
});

describe("Home metrics - honest states", () => {
  it("shows Not connected (not 0) for spend, conversations and ROAS when Meta and WhatsApp aren't connected", () => {
    renderOverview();
    for (const label of ["Campaign spend", "Conversations", "ROAS"]) {
      expect(tile(label)).toHaveAttribute("data-metric-state", "not_connected");
      expect(within(tile(label)).queryByText("0")).not.toBeInTheDocument();
    }
    expect(within(tile("Campaign spend")).getByText("Connect Meta to track spend")).toBeInTheDocument();
    expect(tile("Campaign spend")).toHaveAttribute("href", "/app/integrations");
    expect(tile("Conversations")).toHaveAttribute("href", "/app/integrations");
  });

  it("shows a measured zero for leads and customers, and no data (not 0) for revenue with no rows", () => {
    renderOverview();
    expect(tile("Qualified leads")).toHaveAttribute("data-metric-state", "zero");
    expect(within(tile("Qualified leads")).getByText("0")).toBeInTheDocument();
    expect(tile("Customers")).toHaveAttribute("data-metric-state", "zero");
    expect(tile("Revenue")).toHaveAttribute("data-metric-state", "no_data");
  });

  it("shows real values when connected and data exists", () => {
    mocks.integrations = [{ provider: "meta", status: "connected" }, { provider: "whatsapp", status: "connected" }];
    mocks.kpis = { ...EMPTY_KPIS, spend: [{ currency: "ZAR", amount_minor: 342000 }], conversations: 128, qualified_leads: 14 };
    renderOverview();
    expect(tile("Conversations")).toHaveAttribute("data-metric-state", "value");
    expect(within(tile("Conversations")).getByText("128")).toBeInTheDocument();
    expect(within(tile("Qualified leads")).getByText("14")).toBeInTheDocument();
    expect(tile("Campaign spend")).toHaveAttribute("data-metric-state", "value");
    expect(tile("Campaign spend")).toHaveAttribute("href", "/app/campaigns");
  });

  it("shows plan-locked modules as locked with the plan that includes them, linked to the upgrade screen", () => {
    mocks.enabled = new Set(["module.content", "module.leads", "module.customers"]);
    mocks.locked = new Set(["module.campaigns", "module.whatsapp", "module.analytics", "module.flow_ai"]);
    renderOverview();
    expect(tile("Campaign spend")).toHaveAttribute("data-metric-state", "locked");
    expect(within(tile("Campaign spend")).getByText("Growth plan")).toBeInTheDocument();
    expect(tile("Campaign spend")).toHaveAttribute("href", "/app/campaigns");
    expect(tile("Conversations")).toHaveAttribute("data-metric-state", "locked");
    expect(tile("ROAS")).toHaveAttribute("data-metric-state", "locked");
    // Leads and Customers are in the plan - real measured zeros.
    expect(tile("Qualified leads")).toHaveAttribute("data-metric-state", "zero");
    // Panels for locked modules explain instead of offering connect actions.
    expect(screen.getByText("Campaigns are part of the Growth plan.")).toBeInTheDocument();
    expect(screen.getByText("Messages is part of the Growth plan.")).toBeInTheDocument();
    expect(screen.getByText("Flow AI is part of the Growth plan.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect WhatsApp" })).not.toBeInTheDocument();
  });

  it("explains a permission restriction instead of showing empty numbers", () => {
    mocks.permissions = new Set();
    renderOverview();
    expect(screen.getByText(/Your role doesn.t include analytics/)).toBeInTheDocument();
    expect(document.querySelector("[data-metric-state]")).toBeNull();
  });

  it("says data couldn't load rather than showing zeros when the KPI request fails", () => {
    mocks.kpis = null;
    mocks.kpisError = true;
    renderOverview();
    expect(screen.getAllByText("Couldn't load right now").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("Dashboard operational states", () => {
  it("does not let historical connection activity establish current Meta or WhatsApp status", () => {
    renderOverview();
    expect(tile("Campaign spend")).toHaveAttribute("data-metric-state", "not_connected");
    expect(tile("Conversations")).toHaveAttribute("data-metric-state", "not_connected");
    expect(screen.getByText("Meta connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Integrations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeInTheDocument();
  });

  it("uses compact, provider-aware campaign, conversation, and Flow AI empty states", () => {
    mocks.integrations = [{ provider: "meta", status: "connected" }, { provider: "whatsapp", status: "connected" }];
    renderOverview();
    expect(screen.getByText("Launch your first campaign to see performance here.").parentElement).toHaveClass("py-4");
    expect(screen.getByText(/StabiFlow is connected and ready/).parentElement).toHaveClass("py-4");
    expect(screen.getByText(/No recommendations yet\. As StabiFlow collects campaign and conversion data/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Flow AI" })).toHaveAttribute("href", "/app/flow-ai");
  });

  it("hides the Flow AI panel when the module is off for reasons other than plan", () => {
    mocks.enabled.delete("module.flow_ai");
    renderOverview();
    expect(screen.queryByText("Flow AI recommendations")).not.toBeInTheDocument();
  });

  it("REGRESSION: never renders a literal \\n escape as page text", () => {
    mocks.integrations = [{ provider: "meta", status: "connected" }, { provider: "whatsapp", status: "connected" }];
    const { container } = renderOverview();
    expect(container.textContent).not.toContain("\\n");
  });

  it("shows real campaign and conversation rows, each linking to its record", () => {
    mocks.integrations = [{ provider: "meta", status: "connected" }, { provider: "whatsapp", status: "connected" }];
    mocks.campaigns = [{ campaign_id: "campaign-1", name: "Spring launch", status: "ACTIVE", currency: "ZAR", spend_minor: 12345, leads: 9, customers: 2 }];
    mocks.conversations = [{ id: "conversation-1", display_name: "Nomsa", phone_number: "+27110000000", inbox_status: "unassigned", updated_at: "2026-08-29T08:00:00Z" }];
    renderOverview();
    expect(screen.getByRole("link", { name: /Spring launch/ })).toHaveAttribute("href", "/app/campaigns/campaign-1");
    expect(screen.getByText("9 leads · 2 customers")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Nomsa/ })).toHaveAttribute("href", "/app/whatsapp/inbox");
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for your first conversation")).not.toBeInTheDocument();
  });

  it("filters technical health noise while keeping humanized business activity", () => {
    renderOverview();
    expect(screen.queryByText("Campaign connection checked")).not.toBeInTheDocument();
    expect(screen.getByText("Lead created")).toBeInTheDocument();
  });
});
