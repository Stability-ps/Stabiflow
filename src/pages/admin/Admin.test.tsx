import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminRoutes from "@/pages/admin/AdminRoutes";
import { ROLE_PERMISSIONS, type AdminRole } from "@/lib/adminPermissions";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { email: "owner@example.com" }, profile: { full_name: "Owner Person" }, signOut: vi.fn() }) }));
vi.mock("@/components/layout/BrandLogo", () => ({ BrandLogo: () => <span>StabiFlow</span> }));

const adminConsole = vi.fn();
vi.mock("@/lib/adminApi", async (orig) => {
  const actual = await orig<typeof import("@/lib/adminApi")>();
  return { ...actual, adminConsole: (...a: unknown[]) => adminConsole(...a), downloadAdminExport: vi.fn() };
});
const operatorAdmin = vi.fn();
vi.mock("@/lib/operatorAdmin", () => ({ operatorAdmin: (...a: unknown[]) => operatorAdmin(...a) }));

const OVERVIEW = {
  range: { from: "2026-09-07T00:00:00Z", to: "2026-10-07T00:00:00Z" },
  users: { total: 53, new_in_range: 9, new_today: 1, new_7d: 4, new_30d: 9, signed_in_1d: 3, signed_in_7d: 11, signed_in_30d: 20, unconfirmed: 2, without_workspace: 5 },
  workspaces: { total: 12, new_in_range: 3, active_in_range: 6, paying: 1, suspended: 0 },
  product: {
    leads_created: 0, customers_created: 0, opportunities_created: 0, opportunities_won: 0, automations_active: 1, automation_runs: 0, automation_runs_succeeded: 0,
    automation_runs_failed: 0, posts_published: 0, posts_failed: 0, creative_concepts: 22, creative_failed: 0, website_scans: 4, website_scans_failed: 1,
    messages_in: 3, messages_out: 1, messages_dead_lettered: 0, campaigns_created: 1, profiles_published: 2,
  },
  ai: { calls: 38, succeeded: 38, failed: 0, tokens: 51234, cost_usd: 0.0812, calls_without_cost: 0 },
  revenue: { by_currency: [{ currency: "ZAR", gross_minor: 54800, transactions: 2 }], mrr_by_currency: [{ currency: "ZAR", mrr_minor: 24900, at_risk_minor: 0, subscriptions: 1 }] },
  subscriptions: { active: 1, at_risk: 0, started: 1, cancelled: 0, failed_payments: 0, reversed_payments: 0 },
  series: [{ date: "2026-10-05", signups: 2, workspaces: 1, ai_calls: 5, payments: 1 }, { date: "2026-10-06", signups: 1, workspaces: 0, ai_calls: 0, payments: 0 }],
  tracking_since: { users: "2026-08-20T00:00:00Z", activity_log: "2026-09-01T00:00:00Z", ai_usage: "2026-09-10T00:00:00Z", billing: "2026-10-01T00:00:00Z" },
};

function mockRole(role: AdminRole) {
  adminConsole.mockImplementation(async (action: string) => {
    switch (action) {
      case "me": return { userId: "u-me", role, permissions: ROLE_PERMISSIONS[role] };
      case "overview": return { data: OVERVIEW };
      case "attention": return { alerts: [], generatedAt: new Date().toISOString() };
      case "activity": return { rows: [] };
      case "staff": return { rows: [{ user_id: "u-me", role: "owner", email: "owner@example.com", full_name: "Owner Person", granted_by_name: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", last_sign_in_at: null }, { user_id: "u-2", role: "support", email: "s@example.com", full_name: "Sam Support", granted_by_name: "Owner Person", created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", last_sign_in_at: null }], roles: [] };
      case "revoke_role": return { ok: true };
      default: return {};
    }
  });
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/admin/*" element={<AdminRoutes />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  adminConsole.mockReset();
  operatorAdmin.mockReset();
});
afterEach(cleanup);

describe("Admin access", () => {
  it("shows Access denied when the server says the caller is not staff", async () => {
    const { AdminApiError } = await import("@/lib/adminApi");
    adminConsole.mockRejectedValue(new AdminApiError("Forbidden", 403, null));
    renderAt("/admin");
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByText("Owner dashboard")).not.toBeInTheDocument();
  });

  it("shows only the navigation a role is allowed to use", async () => {
    mockRole("analyst");
    renderAt("/admin");
    const nav = await screen.findByRole("navigation", { name: "Admin" });
    expect(within(nav).getByText("Owner dashboard")).toBeInTheDocument();
    expect(within(nav).getByText("Revenue")).toBeInTheDocument();
    expect(within(nav).queryByText("Users")).not.toBeInTheDocument();
    expect(within(nav).queryByText("Businesses")).not.toBeInTheDocument();
    expect(within(nav).queryByText("Staff & roles")).not.toBeInTheDocument();
  });

  it("explains, rather than renders, a page outside the role", async () => {
    mockRole("marketing");
    renderAt("/admin/users");
    expect(await screen.findByText("Your role does not include this data.")).toBeInTheDocument();
    expect(adminConsole).not.toHaveBeenCalledWith("users", expect.anything());
  });
});

describe("Owner dashboard", () => {
  it("renders live numbers, keeps currencies separate and states data history", async () => {
    mockRole("owner");
    renderAt("/admin");
    expect(await screen.findByText("Registered users")).toBeInTheDocument();
    expect(screen.getByText("53")).toBeInTheDocument();
    expect(screen.getByText("ZAR 548")).toBeInTheDocument();
    expect(screen.getByText("ZAR 249")).toBeInTheDocument();
    expect(screen.getByText(/Nothing needs attention right now/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing before these dates is estimated/)).toBeInTheDocument();
    expect(adminConsole).toHaveBeenCalledWith("overview", expect.objectContaining({ from: expect.any(String), to: expect.any(String) }));
  });

  it("hides revenue from roles without billing access", async () => {
    mockRole("marketing");
    renderAt("/admin");
    expect(await screen.findByText("Registered users")).toBeInTheDocument();
    expect(screen.queryByText("MRR")).not.toBeInTheDocument();
  });

  it("says when payment data is not connected instead of showing zeros", async () => {
    mockRole("owner");
    const base = adminConsole.getMockImplementation()!;
    adminConsole.mockImplementation(async (action: string, p: unknown) =>
      action === "overview" ? { data: { ...OVERVIEW, tracking_since: { ...OVERVIEW.tracking_since, billing: null } } } : base(action, p));
    renderAt("/admin");
    expect(await screen.findByText(/Payment data not connected/)).toBeInTheDocument();
  });
});

describe("Read-only configuration", () => {
  it("disables plan editing for roles that can only read plans", async () => {
    mockRole("admin");
    operatorAdmin.mockResolvedValue({ plans: [], entitlements: [] });
    renderAt("/admin/plans");
    expect(await screen.findByText(/Read-only/)).toBeInTheDocument();
  });

  it("owner gets the editable plan screen", async () => {
    mockRole("owner");
    operatorAdmin.mockResolvedValue({ plans: [], entitlements: [] });
    renderAt("/admin/plans");
    expect(await screen.findByRole("heading", { name: "Plans & pricing" })).toBeInTheDocument();
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
  });
});

describe("Staff & roles", () => {
  it("requires a reason before removing access, then calls the server", async () => {
    mockRole("owner");
    renderAt("/admin/staff");
    fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Remove access" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Left the company" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(adminConsole).toHaveBeenCalledWith("revoke_role", { user_id: "u-2", reason: "Left the company" }));
  });

  it("never offers to remove your own access", async () => {
    mockRole("owner");
    renderAt("/admin/staff");
    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove access" })).toHaveLength(1);
  });
});
