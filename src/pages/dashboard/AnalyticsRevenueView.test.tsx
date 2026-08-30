import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AnalyticsKpis } from "@/hooks/useAnalytics";

const KPIS: AnalyticsKpis = {
  spend: [{ currency: "ZAR", amount_minor: 100_00 }],
  conversations: 5, leads: 3, qualified_leads: 1, opportunities: 1, customers: 1,
  revenue_total: [{ currency: "ZAR", amount_minor: 500_00 }],
  revenue_attributed: [{ currency: "ZAR", amount_minor: 400_00 }],
  revenue_unattributed: [{ currency: "ZAR", amount_minor: 100_00 }],
} as AnalyticsKpis;

const perms = vi.hoisted(() => ({ set: new Set(["view_analytics", "revenue.view"]) }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: "ws-1", hasPermission: (p: string) => perms.set.has(p) }),
}));
vi.mock("@/hooks/useWorkspaceTimezone", () => ({ useWorkspaceTimezone: () => "UTC" }));
vi.mock("@/hooks/useWorkspaceCurrency", () => ({ useWorkspaceCurrency: () => "ZAR" }));
vi.mock("@/hooks/useOnboardingStatus", () => ({ markAnalyticsVisited: () => {} }));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalyticsKpis: () => ({ data: KPIS, isLoading: false, isError: false }),
  useCampaignPerformance: () => ({ data: [], isLoading: false }),
  useCreativePerformance: () => ({ data: [], isLoading: false }),
  useLeadSourceBreakdown: () => ({ data: [], isLoading: false }),
  useWhatsAppAnalytics: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/hooks/useRevenueBreakdown", () => ({
  useRevenueBreakdown: () => ({ source: [], assist: [], day: [], isLoading: false, isError: false }),
}));

import Analytics from "./Analytics";

function renderAnalytics(path = "/app/analytics") {
  return render(<MemoryRouter initialEntries={[path]}><Analytics /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  perms.set = new Set(["view_analytics", "revenue.view"]);
});

describe("Analytics — Revenue view", () => {
  it("defaults to the Overview view", () => {
    renderAnalytics();
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Revenue" })).not.toHaveAttribute("aria-current");
  });

  it("honours ?view=revenue as a deep link and renders the Revenue attribution view", () => {
    renderAnalytics("/app/analytics?view=revenue");
    expect(screen.getByRole("button", { name: "Revenue" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Recorded revenue")).toBeInTheDocument();
    expect(screen.getByText("Revenue by attribution evidence")).toBeInTheDocument();
  });

  it("switches views on tab click without leaving the analytics page", () => {
    renderAnalytics();
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));
    expect(screen.getByRole("button", { name: "Revenue" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Recorded revenue")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Analytics", level: 1 })).toBeInTheDocument();
  });

  it("hides the Revenue tab entirely for a member without revenue.view (audit §19)", () => {
    perms.set = new Set(["view_analytics"]);
    renderAnalytics("/app/analytics?view=revenue");
    expect(screen.queryByRole("button", { name: "Revenue" })).not.toBeInTheDocument();
    // ?view=revenue is ignored -> Overview content renders, no permission wall
    expect(screen.queryByText("Revenue by attribution evidence")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });
});
