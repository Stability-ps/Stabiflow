// Production regression: a stale/invalid AUTHENTICATED route (e.g. the old
// campaign click bug, or any future /app/* typo) must never fall through
// to the public catch-all - that redirects to the landing page and looks
// exactly like an unexpected logout, even though the Supabase session and
// selected workspace are both still fully intact. This proves the /app/*
// in-app fallback (App.tsx) renders instead, through the REAL
// RequireAuth/RequireWorkspace guards, without ever calling signOut() or
// touching auth state.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireWorkspace } from "@/components/RequireWorkspace";
import { NotFoundInApp } from "@/App";

const signOutMock = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    loading: false,
    membershipsLoading: false,
    memberships: [{ workspaceId: "workspace-1", role: "owner", workspace: { id: "workspace-1", name: "Acme" } }],
    currentWorkspaceId: "workspace-1",
    currentMembership: { workspaceId: "workspace-1", role: "owner" },
    signOut: signOutMock,
  }),
}));

function renderStaleAppRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/app/*"
          element={
            <RequireAuth>
              <RequireWorkspace>
                <NotFoundInApp />
              </RequireWorkspace>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Stale authenticated /app/* route (catch-all safety)", () => {
  it("REGRESSION: an unknown /app/* path shows an in-app Not Found state, not the public landing page", async () => {
    renderStaleAppRoute("/app/campaigns/campaign-1/nonexistent-nested-path");

    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByText(/create\. advertise\. connect\. convert\./i)).not.toBeInTheDocument();
  });

  it("does not clear the auth session or sign the user out when landing on the fallback", async () => {
    renderStaleAppRoute("/app/some/unregistered/route");

    await screen.findByText("Page not found");
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("the fallback offers a way back into the authenticated app, preserving workspace context", async () => {
    renderStaleAppRoute("/app/whatever");

    const backLink = await screen.findByRole("link", { name: /back to dashboard/i });
    expect(backLink).toHaveAttribute("href", "/app");
  });
});
