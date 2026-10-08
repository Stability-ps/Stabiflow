// Launch readiness - durable Privacy/Terms acceptance tracking.
//
// Signup.tsx sets user_metadata.legal_acceptance_requested = true and never
// calls the acceptance RPC itself (see Signup.tsx comment) - the recording
// happens here, in useAuth's session bootstrap, so it covers BOTH "session
// exists immediately after signUp()" and "session only exists after the
// user clicks their email confirmation link" with one code path. This
// guards the regression that matters most: a marked account must
// eventually get its durable acceptance rows, and a transient failure must
// retry (not vanish) rather than lose the marker.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";

const { rpcMock, updateUserMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  updateUserMock: vi.fn(),
  fromMock: vi.fn(),
}));

function chainable(resolved: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {};
  obj.select = () => obj;
  obj.eq = () => obj;
  obj.maybeSingle = () => Promise.resolve(resolved);
  obj.then = (onFulfilled: (v: typeof resolved) => unknown) => Promise.resolve(resolved).then(onFulfilled);
  return obj;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => sessionPromise,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      updateUser: updateUserMock,
    },
    // rpc() is a top-level client method, not supabase.auth.rpc().
    rpc: rpcMock,
    from: fromMock,
  },
}));

function makeUser(legalAcceptanceRequested: boolean) {
  return { id: "user-1", user_metadata: { legal_acceptance_requested: legalAcceptanceRequested } };
}

let sessionPromise: Promise<{ data: { session: { user: ReturnType<typeof makeUser> } | null } }>;

function Probe() {
  useAuth();
  return null;
}

function renderAuth() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("useAuth - legal acceptance bootstrap", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records acceptance and clears the marker when a session's user has legal_acceptance_requested=true", async () => {
    sessionPromise = Promise.resolve({ data: { session: { user: makeUser(true) } } });
    fromMock.mockImplementation((table: string) =>
      table === "workspace_members" ? chainable({ data: [], error: null }) : chainable({ data: null, error: null }),
    );
    rpcMock.mockResolvedValue({ data: [{ document_type: "privacy_policy" }], error: null });
    updateUserMock.mockResolvedValue({ data: {}, error: null });

    renderAuth();

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("accept_current_legal_terms"));
    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({ data: { legal_acceptance_requested: false } }));
  });

  it("does NOT call the RPC for a user without the marker (no fabricated acceptance for existing/unrelated users)", async () => {
    sessionPromise = Promise.resolve({ data: { session: { user: makeUser(false) } } });
    fromMock.mockImplementation((table: string) =>
      table === "workspace_members" ? chainable({ data: [], error: null }) : chainable({ data: null, error: null }),
    );

    renderAuth();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("leaves the marker set (does not call updateUser) if the RPC call fails, so the next bootstrap retries", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionPromise = Promise.resolve({ data: { session: { user: makeUser(true) } } });
    fromMock.mockImplementation((table: string) =>
      table === "workspace_members" ? chainable({ data: [], error: null }) : chainable({ data: null, error: null }),
    );
    rpcMock.mockResolvedValue({ data: null, error: { message: "temporary failure" } });

    renderAuth();

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updateUserMock).not.toHaveBeenCalled();
    // No email/name/legal text in the log - just enough to notice in ops.
    expect(consoleError.mock.calls[0]?.join(" ")).not.toMatch(/@/);
    consoleError.mockRestore();
  });
});
