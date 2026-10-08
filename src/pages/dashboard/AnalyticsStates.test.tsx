// Analytics redesign: a section whose own query fails says so (it is never
// rendered as "No campaigns yet" / "No leads"), and KPI tiles never invent
// a zero for a rate or cost that has no data.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnalyticsKpis } from "@/hooks/useAnalytics";

const state = vi.hoisted(() => ({ kpis: null as unknown, kpisError: false, sectionError: false, refetch: vi.fn() }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "ws-1", user: { id: "u1" }, hasPermission: () => true }) }));
vi.mock("@/hooks/useWorkspaceTimezone", () => ({ useWorkspaceTimezone: () => "UTC" }));
vi.mock("@/hooks/useWorkspaceCurrency", () => ({ useWorkspaceCurrency: () => "ZAR" }));
vi.mock("@/hooks/useOnboardingStatus", () => ({ markAnalyticsVisited: () => {} }));
vi.mock("@/hooks/useAnalytics", () => {
  const section = (data: unknown) => () => ({ data: state.sectionError ? undefined : data, isLoading: false, isError: state.sectionError, refetch: state.refetch });
  return {
    useAnalyticsKpis: () => ({ data: state.kpisError ? undefined : state.kpis, isLoading: false, isError: state.kpisError, refetch: state.refetch }),
    useCampaignPerformance: section([]),
    useCreativePerformance: section([]),
    useLeadSourceBreakdown: section([]),
    useWhatsAppAnalytics: section(null),
    useCrmPerformance: section({ active: 0, qualified: 0, converted: 0, lost: 0, follow_ups_due: 0, follow_ups_overdue: 0, follow_ups_completed: 0, conversion_rate: 0, qualification_rate: 0, lost_reasons: [] }),
  };
});
vi.mock("@/lib/creatorCampaigns", async () => {
  const actual = await vi.importActual<typeof import("@/lib/creatorCampaigns")>("@/lib/creatorCampaigns");
  return { ...actual, listCreatorCampaignPerformance: async () => { if (state.sectionError) throw new Error("boom"); return []; } };
});

import Analytics from "./Analytics";

const KPIS: AnalyticsKpis = {
  spend: [{ currency: "ZAR", amount_minor: 100_00 }],
  conversations: 5, leads: 0, qualified_leads: 0, opportunities: 0, customers: 0,
  revenue_total: [], revenue_attributed: [], revenue_unattributed: [],
} as AnalyticsKpis;

function renderAnalytics(path = "/app/analytics") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Analytics /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { state.kpis = KPIS; state.kpisError = false; state.sectionError = false; });
afterEach(cleanup);

describe("Analytics - honest states", () => {
  it("a failed headline read shows an error with retry", () => {
    state.kpisError = true;
    renderAnalytics();
    expect(screen.getByText("Couldn't load analytics")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("failed section queries show errors, not 'No campaigns yet' / 'No leads'", () => {
    state.sectionError = true;
    renderAnalytics();
    expect(screen.getAllByRole("alert")).toHaveLength(5);
    expect(screen.queryByText("No campaigns yet")).not.toBeInTheDocument();
    expect(screen.queryByText("No leads in this range")).not.toBeInTheDocument();
    expect(screen.queryByText("No published creatives yet")).not.toBeInTheDocument();
  });

  it("cost per lead with zero leads is 'no data', not a zero cost", () => {
    renderAnalytics();
    const tile = screen.getByText("Cost / lead").closest("[data-metric-state]") as HTMLElement;
    expect(tile).toHaveAttribute("data-metric-state", "no_data");
    expect(within(tile).getByText("No outcomes this period")).toBeInTheDocument();
  });

  it("CRM rates with no leads in the range are 'no data', not 0.0%", () => {
    renderAnalytics();
    const tile = screen.getByText("Qualification rate").closest("[data-metric-state]") as HTMLElement;
    expect(tile).toHaveAttribute("data-metric-state", "no_data");
    const conversion = screen.getByText("Lead conversion").closest("[data-metric-state]") as HTMLElement;
    expect(conversion).toHaveAttribute("data-metric-state", "no_data");
    expect(within(conversion).queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("a failed creator-campaigns read shows an error, not zero totals", async () => {
    state.sectionError = true;
    renderAnalytics("/app/analytics?view=creators");
    expect(await screen.findByText("Couldn't load creator campaigns")).toBeInTheDocument();
    expect(screen.queryByText("Creator spend")).not.toBeInTheDocument();
  });
});
