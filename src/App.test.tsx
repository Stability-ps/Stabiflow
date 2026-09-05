// Production regression: after the frontend routing cleanup, the Meta
// OAuth callback redirected to "/integrations" (removed) with no
// catch-all route to fall back to, so React Router rendered nothing at
// all - a blank white page - both on success and on failure. This guards
// the two properties that must hold:
//   1. any unmatched path (a stale link, including the old bare
//      "/integrations" path) must render something, never a blank page.
//   2. the real authenticated Integrations route ("/app/integrations",
//      the one integrations-oauth-callback now redirects to) must still
//      be registered and reachable.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { AppRoutes } from "@/App";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("App routing blank-page regression", () => {
  it("REGRESSION: an unmatched/stale path never renders blank - it falls back to the landing page", async () => {
    renderAt("/some/stale-bookmarked-path");
    expect((await screen.findAllByText(/meta advertising/i)).length).toBeGreaterThan(0);
  });

  it("REGRESSION: the old removed '/integrations' path (pre-cleanup OAuth return target) never renders blank", async () => {
    renderAt("/integrations");
    expect((await screen.findAllByText(/meta advertising/i)).length).toBeGreaterThan(0);
  });

  it("the real '/app/integrations' route (the OAuth callback's redirect target) is registered and reachable, not swallowed by the catch-all", async () => {
    renderAt("/app/integrations");
    // Unauthenticated, so RequireAuth redirects to /login instead of
    // rendering Integrations - but that proves the route matched and
    // guarded correctly, rather than falling through to the "*" catch-all.
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });
});
