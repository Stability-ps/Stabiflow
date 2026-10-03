import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Operator from "./Operator";

const authState: { profile: { is_platform_operator: boolean } | null } = { profile: null };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

const operatorAdmin = vi.fn();
vi.mock("@/lib/operatorAdmin", () => ({ operatorAdmin: (...args: unknown[]) => operatorAdmin(...args) }));
vi.mock("@/lib/operator", () => ({
  searchOperatorWorkspaces: vi.fn().mockResolvedValue({ ok: true, workspaces: [] }),
  getOperatorWorkspace: vi.fn(),
  suspendOperatorWorkspace: vi.fn(),
  unsuspendOperatorWorkspace: vi.fn(),
}));

function renderAt(path = "/app/operator") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Operator />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const overview = {
  workspaces: 12, newWorkspaces30d: 3, users: 20, subscriptions: { total: 2, byPlan: { business: { name: "Business", count: 2 } }, pastDueOrGrace: 1 },
  mrrMinor: 49800, revenue30dMinor: 49800, currency: "ZAR", billingAlerts: { failedWebhooks7d: 0, amountMismatches: 1, pendingCheckouts: 0 },
  ai30d: { costUsd: 1.5, tokens: 1000 }, failures7d: { automations: 0, contentPosts: 0 }, businessProfilesWithWebsite: 4,
};

describe("Platform admin shell", () => {
  afterEach(() => {
    cleanup();
    operatorAdmin.mockReset();
  });

  it("refuses non-operators without calling the admin API", () => {
    authState.profile = { is_platform_operator: false };
    renderAt();
    expect(screen.getByText(/don't have operator access/i)).toBeInTheDocument();
    expect(operatorAdmin).not.toHaveBeenCalled();
  });

  it("shows every admin area and loads the overview for operators", async () => {
    authState.profile = { is_platform_operator: true };
    operatorAdmin.mockResolvedValue(overview);
    renderAt();
    for (const label of ["Overview", "Businesses & users", "Plans & pricing", "Feature flags", "Subscriptions & payments", "Usage & limits", "Launch readiness", "Settings & content", "System & audit"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByText("Payments needing review")).toBeInTheDocument());
    expect(operatorAdmin).toHaveBeenCalledWith("overview");
    expect(screen.getByText(/^Business:/)).toBeInTheDocument();
  });

  it("opens the tab named in the URL", async () => {
    authState.profile = { is_platform_operator: true };
    operatorAdmin.mockResolvedValue({ flags: [], targets: [] });
    renderAt("/app/operator?tab=flags");
    await waitFor(() => expect(operatorAdmin).toHaveBeenCalledWith("list_flags"));
  });

  it("never renders credential values in System - only configured/missing", async () => {
    authState.profile = { is_platform_operator: true };
    operatorAdmin.mockImplementation((action: string) =>
      Promise.resolve(
        action === "system_status"
          ? { secrets: [{ name: "PAYSTACK_SECRET_KEY", area: "Payments", required: true, configured: true }], paystackMode: "test", failedJobs: { automationRuns: [], contentPosts: [], billingWebhooks: [] }, whatsappWebhookEvents7d: 0 }
          : { admin: [], workspaceActions: [] },
      ),
    );
    renderAt("/app/operator?tab=system");
    await waitFor(() => expect(screen.getByText("PAYSTACK_SECRET_KEY")).toBeInTheDocument());
    expect(screen.getByLabelText("Configured")).toBeInTheDocument();
  });
});
