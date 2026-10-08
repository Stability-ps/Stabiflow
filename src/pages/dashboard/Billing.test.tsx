// Billing redesign: an unreadable or still-loading plan is never shown as
// "Free" - that would tell a paying customer they've lost their plan.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Billing from "./Billing";

const mocks = vi.hoisted(() => ({
  fetchBillingState: vi.fn(),
  fetchCatalog: vi.fn(),
  fetchEntitlements: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "workspace-1", hasPermission: () => true }) }));
vi.mock("@/components/guide/GuideHelpLink", () => ({ GuideHelpLink: () => null }));
vi.mock("@/lib/billing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing")>("@/lib/billing");
  return {
    ...actual,
    fetchBillingState: mocks.fetchBillingState,
    fetchCatalog: mocks.fetchCatalog,
    fetchEntitlements: mocks.fetchEntitlements,
    fetchEntitlementNames: async () => ({}),
    startCheckout: vi.fn(),
    verifyPayment: vi.fn(),
    cancelSubscription: vi.fn(),
  };
});

const SUB = {
  subscription: {
    status: "active", current_period_end: "2026-11-01T00:00:00.000Z", grace_until: null,
    plan: { code: "growth", name: "Growth", tier_rank: 2 }, price: { amount_minor: 49900, currency: "ZAR", billing_interval: "month" },
  },
  purchases: [], transactions: [],
};

function renderBilling() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><Billing /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  mocks.fetchCatalog.mockReset().mockResolvedValue([]);
  mocks.fetchEntitlements.mockReset().mockResolvedValue([]);
  mocks.fetchBillingState.mockReset().mockResolvedValue(SUB);
});
afterEach(cleanup);

describe("Billing - honest plan state", () => {
  it("shows the active subscription", async () => {
    renderBilling();
    expect(await screen.findByText("Growth")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("Free")).not.toBeInTheDocument();
  });

  it("a failed billing read shows an error with retry, never 'Free'", async () => {
    mocks.fetchBillingState.mockRejectedValue(new Error("boom"));
    renderBilling();
    expect(await screen.findByText("Couldn't load your plan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("Free")).not.toBeInTheDocument();
  });

  it("while loading, the plan is not shown as 'Free'", () => {
    mocks.fetchBillingState.mockReturnValue(new Promise(() => {}));
    renderBilling();
    expect(screen.getByLabelText("Loading your plan")).toBeInTheDocument();
    expect(screen.queryByText("Free")).not.toBeInTheDocument();
  });

  it("a failed catalog read is announced instead of silently showing no plans", async () => {
    mocks.fetchCatalog.mockRejectedValue(new Error("boom"));
    renderBilling();
    expect(await screen.findByText("Couldn't load the available plans.")).toBeInTheDocument();
  });

  it("a failed entitlements read is announced", async () => {
    mocks.fetchEntitlements.mockRejectedValue(new Error("boom"));
    renderBilling();
    expect(await screen.findByText(/Couldn't load what your plan includes/)).toBeInTheDocument();
  });
});
