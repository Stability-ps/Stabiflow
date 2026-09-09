// Window-focus refresh stability regression - see useAuth.focusStability.test.tsx
// for the auth-provider half of this fix. Even if some future code path
// re-triggers membershipsLoading unexpectedly, RequireWorkspace itself must
// not blank an already-populated dashboard: a full-page loading state is
// only correct when there is no cached membership data to show yet.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RequireWorkspace } from "@/components/RequireWorkspace";

const authState: {
  membershipsLoading: boolean;
  memberships: { workspaceId: string }[];
  currentWorkspaceId: string | null;
} = {
  membershipsLoading: true,
  memberships: [],
  currentWorkspaceId: null,
};

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

function renderGuard() {
  return render(
    <MemoryRouter>
      <RequireWorkspace>
        <div data-testid="dashboard-content">Dashboard</div>
      </RequireWorkspace>
    </MemoryRouter>,
  );
}

describe("RequireWorkspace - initial load vs background refetch", () => {
  it("shows the full-page loading state on the true initial bootstrap (no memberships known yet)", () => {
    authState.membershipsLoading = true;
    authState.memberships = [];
    authState.currentWorkspaceId = null;

    renderGuard();

    expect(screen.getByText(/Loading your workspaces/i)).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-content")).not.toBeInTheDocument();
  });

  it("keeps the dashboard mounted during a background refetch when memberships are already known", () => {
    authState.membershipsLoading = true;
    authState.memberships = [{ workspaceId: "ws-1" }];
    authState.currentWorkspaceId = "ws-1";

    renderGuard();

    expect(screen.queryByText(/Loading your workspaces/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-content")).toBeInTheDocument();
  });

  it("redirects to create-workspace once loading has settled with zero memberships", () => {
    authState.membershipsLoading = false;
    authState.memberships = [];
    authState.currentWorkspaceId = null;

    renderGuard();

    expect(screen.queryByTestId("dashboard-content")).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading your workspaces/i)).not.toBeInTheDocument();
  });
});
