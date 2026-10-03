// Production regression: after Meta returns via
// integrations-oauth-callback to /app/integrations?integration_connected=meta
// (or ?integration_error=...), the browser did a full top-level navigation
// straight into RequireAuth -> RequireWorkspace -> AppLayout -> Integrations.
// Earlier coverage (App.test.tsx) only proved the route MATCHES while
// unauthenticated (so RequireAuth redirects to /login) - it never proved
// that an authenticated user with a resolved workspace actually sees a
// visible, populated Integrations page at that exact URL instead of a
// blank screen. This exercises the REAL guard components end-to-end with
// an authenticated + workspace-resolved auth state.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireWorkspace } from "@/components/RequireWorkspace";
import Integrations from "@/pages/dashboard/Integrations";

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    loading: false,
    membershipsLoading: false,
    memberships: [{ workspaceId: "workspace-1", role: "owner", workspace: { id: "workspace-1", name: "Acme" } }],
    currentWorkspaceId: "workspace-1",
    currentMembership: { workspaceId: "workspace-1", role: "owner" },
  }),
}));

vi.mock("@/hooks/useIntegrations", () => ({
  useWorkspaceIntegrations: () => ({ data: [], isLoading: false }),
  useAllFacebookPages: () => ({ data: [] }),
  useAllInstagramAccounts: () => ({ data: [] }),
  useAllMetaAdAccounts: () => ({ data: [] }),
  useAllWhatsAppNumbers: () => ({ data: [] }),
}));

function renderOauthReturn(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/app/integrations"
          element={
            <RequireAuth>
              <RequireWorkspace>
                <Integrations />
              </RequireWorkspace>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Meta OAuth return renders a visible page (not blank) after auth/workspace resolution", () => {
  afterEach(() => {
    cleanup();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("REGRESSION: ?integration_connected=meta renders the visible Integrations page through the real RequireAuth/RequireWorkspace guards", async () => {
    renderOauthReturn("/app/integrations?integration_connected=meta");

    // A successful connect opens the manage-resources Sheet, which marks
    // the rest of the page aria-hidden - so assert on the Sheet dialog
    // itself (visible, non-blank content) rather than the now-hidden h1.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith(expect.stringContaining("Meta connected"));
  });

  it("REGRESSION: ?integration_error=... renders the visible Integrations page (not blank) with a friendly error toast", async () => {
    renderOauthReturn("/app/integrations?integration_error=access_denied");

    expect(await screen.findByRole("heading", { name: "Integrations" })).toBeInTheDocument();
    expect(toastErrorMock).toHaveBeenCalledWith("You cancelled the connection - nothing was connected.");
  });

  it("renders visibly with no query params at all (direct navigation, no OAuth return in progress)", async () => {
    renderOauthReturn("/app/integrations");

    expect(await screen.findByRole("heading", { name: "Integrations" })).toBeInTheDocument();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
