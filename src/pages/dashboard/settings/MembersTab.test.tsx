import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MembersTab } from "./MembersTab";

const mocks = vi.hoisted(() => ({
  inviteMember: vi.fn(),
  writeText: vi.fn(),
  invitations: [] as Array<Record<string, unknown>>,
  membersError: false,
  seats: { entitlement_key: "team_seats", kind: "limit", enabled: true, unlimited: false, limit_value: 5, used: 0, source: "plan" } as Record<string, unknown>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: "workspace-1", currentMembership: { role: "owner" }, user: { id: "user-1" } }),
}));
vi.mock("@/hooks/useWorkspaceMembers", () => ({
  useWorkspaceMembers: () => ({ data: mocks.membersError ? undefined : [], isLoading: false, isError: mocks.membersError, refetch: vi.fn() }),
  useWorkspacePendingInvitations: () => ({ data: mocks.invitations, isLoading: false, isError: false, refetch: vi.fn() }),
}));
// Inviting is gated on the plan's team_seats entitlement (17cf182, ab4cc54).
vi.mock("@/lib/billing", () => ({ fetchEntitlements: async () => [mocks.seats] }));
vi.mock("@/lib/workspaceMembers", () => ({
  inviteMember: mocks.inviteMember,
  revokeInvitation: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

function renderMembers() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MembersTab /></QueryClientProvider>);
}

describe("Members invitations", () => {
  beforeEach(() => {
    mocks.inviteMember.mockReset().mockResolvedValue({ token: "complete-secret-token", expiresAt: "2026-09-05T10:30:00.000Z" });
    mocks.writeText.mockReset().mockResolvedValue(undefined);
    mocks.invitations = [];
    mocks.membersError = false;
    mocks.seats = { entitlement_key: "team_seats", kind: "limit", enabled: true, unlimited: false, limit_value: 5, used: 0, source: "plan" };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.writeText } });
  });
  afterEach(cleanup);

  it("shows invitation email, role, expiry, and copies the complete underlying URL", async () => {
    renderMembers();
    fireEvent.click(await screen.findByRole("button", { name: /invite member/i }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Teammate@Example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /create invitation/i }));

    expect(await screen.findByText("teammate@example.com")).toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
    expect(screen.getByText(new Date("2026-09-05T10:30:00.000Z").toLocaleString())).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(`${window.location.origin}/accept-invitation?token=complete-secret-token`));
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("shows authoritative pending/expired status and disables copying expired links", async () => {
    mocks.invitations = [
      { id: "pending", email: "pending@example.com", role: "viewer", expires_at: "2099-01-01T00:00:00.000Z", token: "pending-token", status: "pending" },
      { id: "expired", email: "expired@example.com", role: "editor", expires_at: "2020-01-01T00:00:00.000Z", token: "expired-token", status: "pending" },
    ];
    renderMembers();
    expect(await screen.findByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Copy link" })[1]).toBeDisabled();
  });

  it("disables inviting when every team seat is committed (members plus pending invitations)", async () => {
    mocks.seats = { entitlement_key: "team_seats", kind: "limit", enabled: true, unlimited: false, limit_value: 1, used: 0, source: "plan" };
    mocks.invitations = [{ id: "pending", email: "pending@example.com", role: "viewer", expires_at: "2099-01-01T00:00:00.000Z", token: "t", status: "pending" }];
    renderMembers();
    expect(await screen.findByRole("button", { name: /invite member/i })).toBeDisabled();
  });
});

describe("Members load failure", () => {
  afterEach(() => { cleanup(); mocks.membersError = false; });
  it("a failed members read shows an error with retry, not 'No pending invitations' or a seat count", async () => {
    mocks.membersError = true;
    renderMembers();
    expect(await screen.findByText("Couldn't load members")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No pending invitations")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invite member/i })).not.toBeInTheDocument();
  });
});
