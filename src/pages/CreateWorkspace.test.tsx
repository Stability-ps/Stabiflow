// Regression test for the "create workspace succeeds but the app never
// leaves /create-workspace" bug. A navigate("/") call alone doesn't prove
// this is fixed - the actual failure mode is a route-guard race:
// RequireWorkspace reads memberships/currentWorkspaceId from AuthContext,
// and if that context still shows zero memberships at the moment the
// router renders "/", it bounces straight back to /create-workspace
// regardless of navigate() having fired.
//
// The mock below deliberately makes the workspace_members table ALWAYS
// return an empty list - simulating a refetch that never catches up (slow
// network, read-after-write lag, or simply not resolving before the next
// render). If CreateWorkspace's post-create redirect ever regresses to
// depend on that query reflecting the new row - directly, or indirectly via
// a "reconcile in the background" refetch that overwrites optimistic state
// (a real bug this test caught during development, see git history) - this
// test fails exactly the way the real bug did: stuck on
// "Create your workspace".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireWorkspace } from "@/components/RequireWorkspace";
import CreateWorkspace from "@/pages/CreateWorkspace";

// Mounted alongside the dashboard route so tests can assert on the actual
// AuthContext state a route guard would see, not just the rendered DOM.
function AuthStateProbe() {
  const { memberships, currentWorkspaceId } = useAuth();
  return <div data-testid="auth-state">{JSON.stringify({ membershipCount: memberships.length, currentWorkspaceId })}</div>;
}

const FAKE_USER = { id: "user-1", email: "test@example.com" };
const FAKE_SESSION = { user: FAKE_USER, access_token: "fake-token" };
const NEW_WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";

function chainable(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    select: () => obj,
    eq: () => obj,
    order: () => obj,
    limit: () => obj,
    in: () => obj,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return obj;
}

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: FAKE_SESSION } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: () => Promise.resolve({ error: null }),
    },
    from: (table: string) => {
      if (table === "profiles") return chainable({ data: null, error: null });
      if (table === "workspace_members") {
        // Never reflects the new membership - see file header.
        return chainable({ data: [], error: null });
      }
      throw new Error(`Unexpected table queried in test: ${table}`);
    },
    rpc: rpcMock,
  },
}));

function renderApp() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/create-workspace"]}>
        <Routes>
          <Route path="/create-workspace" element={<RequireAuth><CreateWorkspace /></RequireAuth>} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AuthStateProbe />
                <RequireWorkspace>
                  <div>DASHBOARD SHELL</div>
                </RequireWorkspace>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("CreateWorkspace -> dashboard routing (regression: post-create route-guard bounce-back)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("REGRESSION: reaches the dashboard immediately after create_workspace() succeeds, even when the workspace_members refetch never reflects the new row", async () => {
    rpcMock.mockResolvedValue({ data: NEW_WORKSPACE_ID, error: null });
    renderApp();

    const nameInput = await screen.findByLabelText(/company name/i);
    fireEvent.change(nameInput, { target: { value: "Regression Test Co" } });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(screen.getByText("DASHBOARD SHELL")).toBeInTheDocument());
    expect(screen.queryByText(/create your workspace/i)).not.toBeInTheDocument();
    expect(rpcMock).toHaveBeenCalledWith("create_workspace", expect.objectContaining({ p_name: "Regression Test Co", p_slug: "regression-test-co" }));

    // The route guard let the user through because the context genuinely
    // has the new membership - not because the guard was bypassed.
    const state = JSON.parse(screen.getByTestId("auth-state").textContent || "{}");
    expect(state.membershipCount).toBe(1);
    expect(state.currentWorkspaceId).toBe(NEW_WORKSPACE_ID);
  });

  it("a failed create_workspace() call surfaces an error and never navigates away", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderApp();

    const nameInput = await screen.findByLabelText(/company name/i);
    fireEvent.change(nameInput, { target: { value: "Should Not Work" } });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(screen.getByText(/create your workspace/i)).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD SHELL")).not.toBeInTheDocument();
  });

  it("an RPC success with no returned workspace id does not silently navigate away", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    renderApp();

    const nameInput = await screen.findByLabelText(/company name/i);
    fireEvent.change(nameInput, { target: { value: "No Id Returned" } });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(screen.getByText(/create your workspace/i)).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD SHELL")).not.toBeInTheDocument();
  });
});
