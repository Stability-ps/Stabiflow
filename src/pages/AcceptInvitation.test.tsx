import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AcceptInvitation from "./AcceptInvitation";
import { WorkspaceInvitationError } from "@/lib/workspaceMembers";

const mocks = vi.hoisted(() => ({
  accept: vi.fn(), signOut: vi.fn(), addMembership: vi.fn(), setWorkspace: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "signed-in@example.com" }, loading: false,
    addWorkspaceMembership: mocks.addMembership, setCurrentWorkspaceId: mocks.setWorkspace, signOut: mocks.signOut,
  }),
}));
vi.mock("@/lib/workspaceMembers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaceMembers")>("@/lib/workspaceMembers");
  return { ...actual, acceptWorkspaceInvitation: mocks.accept };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const result = { data: { workspace_id: "workspace-1", role: "viewer", workspace: { id: "workspace-1", name: "Workspace" } } };
      const chain = { select: () => chain, eq: () => chain, single: () => Promise.resolve(result) };
      return chain;
    },
  },
}));

function renderInvitation(path = "/accept-invitation?token=token-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/accept-invitation" element={<AcceptInvitation />} />
        <Route path="/app" element={<div>DASHBOARD</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AcceptInvitation states", () => {
  beforeEach(() => {
    mocks.accept.mockReset(); mocks.signOut.mockReset().mockResolvedValue({ error: null });
    mocks.addMembership.mockReset(); mocks.setWorkspace.mockReset();
  });
  afterEach(cleanup);

  it("shows a friendly invalid-link state without calling the backend", () => {
    renderInvitation("/accept-invitation");
    expect(screen.getByText("Invalid invitation link")).toBeInTheDocument();
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("preserves wrong-email security and offers account switching without revealing the invited email", async () => {
    mocks.accept.mockRejectedValue(new WorkspaceInvitationError("wrong_email", "You are signed in with a different account. Sign in using the email address this invitation was sent to."));
    renderInvitation();
    expect(await screen.findByText(/signed in with a different account/i)).toBeInTheDocument();
    expect(screen.queryByText(/invited@example/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sign out and switch account/i }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["expired", "This invitation has expired. Ask a workspace admin to create a new invitation."],
    ["unavailable", "This invitation is no longer available. It may already have been accepted or revoked. Ask a workspace admin for a new link."],
  ] as const)("renders a friendly %s state", async (reason, message) => {
    mocks.accept.mockRejectedValue(new WorkspaceInvitationError(reason, message));
    renderInvitation();
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("merges the accepted membership and reaches the app", async () => {
    mocks.accept.mockResolvedValue("workspace-1");
    renderInvitation();
    expect(await screen.findByText("DASHBOARD")).toBeInTheDocument();
    expect(mocks.addMembership).toHaveBeenCalled();
    expect(mocks.setWorkspace).toHaveBeenCalledWith("workspace-1");
  });
});
