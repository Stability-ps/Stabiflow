import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { FeatureGate } from "@/components/FeatureGate";
import { AppSidebar } from "./AppSidebar";
import { NAV_ITEMS } from "@/lib/navigation";
import { filterNavItems, planLockedNavItems, toFlagLookup, toPlanLockLookup, type EvaluatedFlag } from "@/lib/featureFlags";

// End to end through the real pieces: evaluator rows -> sidebar -> click the
// locked item -> the module's route, where the real FeatureGate decides.
// A plan lock is presentation only: the route must still refuse the module.
const ROWS: EvaluatedFlag[] = [
  { flag_key: "module.leads", enabled: true, reason: "plan" },
  { flag_key: "module.flow_ai", enabled: false, reason: "not_targeted" },
  { flag_key: "module.analytics", enabled: true, reason: "plan" },
];

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({
    isEnabled: toFlagLookup(ROWS),
    isPlanLocked: toPlanLockLookup(ROWS),
    isLoading: false,
    hasAdvancedModules: true,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    currentWorkspaceId: "workspace-1",
    currentMembership: { role: "owner", workspace: { name: "Ubuntu Bakery" } },
    memberships: [{ workspaceId: "workspace-1", role: "owner", workspace: { name: "Ubuntu Bakery" } }],
    setCurrentWorkspaceId: vi.fn(),
  }),
}));
vi.mock("@/lib/billing", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing")>()),
  fetchBillingState: async () => ({ subscription: null, purchases: [], transactions: [] }),
}));
vi.mock("@/lib/adminApi", async (orig) => {
  const real = await orig<typeof import("@/lib/adminApi")>();
  return { ...real, adminConsole: async () => { throw new real.AdminApiError("forbidden", 403, null); } };
});

afterEach(cleanup);

function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const isEnabled = toFlagLookup(ROWS);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <SidebarProvider>
          <AppSidebar items={filterNavItems(NAV_ITEMS, isEnabled)} lockedItems={planLockedNavItems(NAV_ITEMS, toPlanLockLookup(ROWS))} />
          <Routes>
            <Route path="/app" element={<p>home page</p>} />
            <Route path="/app/flow-ai" element={<FeatureGate flag="module.flow_ai"><p>FLOW AI MODULE</p></FeatureGate>} />
            <Route path="/app/leads" element={<FeatureGate flag="module.leads"><p>LEADS MODULE</p></FeatureGate>} />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("plan-locked navigation keeps enforcement", () => {
  it("a not_targeted module is visible and locked, and its route shows the upgrade screen - never the module", () => {
    renderApp("/app");
    const locked = screen.getByRole("link", { name: /Flow AI \(locked\)/ });
    expect(locked).toHaveAttribute("data-locked", "true");
    fireEvent.click(locked);
    expect(screen.queryByText("FLOW AI MODULE")).not.toBeInTheDocument();
    expect(screen.getByText("Flow AI is part of the Growth plan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/app/billing");
    expect(screen.getByRole("link", { name: /Flow AI \(locked\)/ })).toHaveAttribute("aria-current", "page");
  });

  it("a deep link straight to a locked route is still refused", () => {
    renderApp("/app/flow-ai");
    expect(screen.queryByText("FLOW AI MODULE")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See plans" })).toBeInTheDocument();
  });

  it("an included module is a normal link and opens the module", () => {
    renderApp("/app");
    const leads = screen.getByRole("link", { name: "Leads" });
    expect(leads).not.toHaveAttribute("data-locked");
    fireEvent.click(leads);
    expect(screen.getByText("LEADS MODULE")).toBeInTheDocument();
  });

  it("modules not in the evaluator rows are neither shown nor locked", () => {
    renderApp("/app");
    expect(screen.queryByRole("link", { name: /^Campaigns/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Automations/ })).not.toBeInTheDocument();
  });
});
