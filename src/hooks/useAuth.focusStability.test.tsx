// Window-focus refresh stability regression.
//
// Supabase's GoTrueClient re-notifies onAuthStateChange (TOKEN_REFRESHED,
// or a re-emitted SIGNED_IN) purely because a tab regained visibility -
// see GoTrueClient#_onVisibilityChanged - independent of anything this app
// asked for. Before this fix, useAuth treated every notification
// identically: it re-ran loadProfileAndMemberships() with
// setMembershipsLoading(true), and RequireWorkspace used that flag to
// unmount the entire authenticated shell and show a bare "Loading your
// workspaces..." screen. That wiped scroll position, unsaved form state,
// and selections on every tab switch. This guards that a re-notification
// for the SAME user is a silent background refresh (no membershipsLoading
// flip), while a genuine different-user transition still shows loading.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";

// jsdom's default test origin ("about:blank") leaves window.localStorage
// undefined - AuthProvider reads it synchronously on mount, so give this
// file its own in-memory stand-in rather than touching the global test
// setup (src/test/setup.ts) other suites rely on.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  get length() {
    return this.store.size;
  }
}
Object.defineProperty(window, "localStorage", { value: new MemoryStorage(), writable: true });

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

function chainable(resolved: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {};
  obj.select = () => obj;
  obj.eq = () => obj;
  obj.maybeSingle = () => Promise.resolve(resolved);
  obj.then = (onFulfilled: (v: typeof resolved) => unknown) => Promise.resolve(resolved).then(onFulfilled);
  return obj;
}

let authChangeCallback: (event: string, session: unknown) => void = () => {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => sessionPromise,
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authChangeCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      updateUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: fromMock,
  },
}));

function makeUser(id: string) {
  return { id, user_metadata: {} };
}

function makeSession(id: string) {
  return { user: makeUser(id) };
}

let sessionPromise: Promise<{ data: { session: { user: ReturnType<typeof makeUser> } | null } }>;

function Probe({ historyRef }: { historyRef: { current: boolean[] } }) {
  const { membershipsLoading, memberships, user } = useAuth();
  useEffect(() => {
    historyRef.current.push(membershipsLoading);
  }, [historyRef, membershipsLoading]);
  return (
    <div data-testid="state">
      {JSON.stringify({ membershipsLoading, memberships: memberships.length, userId: user?.id ?? null })}
    </div>
  );
}

function renderAuth(historyRef: { current: boolean[] }) {
  return render(
    <AuthProvider>
      <Probe historyRef={historyRef} />
    </AuthProvider>,
  );
}

function readState() {
  return JSON.parse(screen.getByTestId("state").textContent as string) as {
    membershipsLoading: boolean;
    memberships: number;
    userId: string | null;
  };
}

describe("useAuth - window-focus refresh stability", () => {
  afterEach(() => {
    vi.clearAllMocks();
    authChangeCallback = () => {};
  });

  it("re-notifying for the SAME user (focus-triggered TOKEN_REFRESHED) never flips membershipsLoading back to true", async () => {
    sessionPromise = Promise.resolve({ data: { session: { user: makeUser("user-1") } } });
    fromMock.mockImplementation((table: string) =>
      table === "workspace_members"
        ? chainable({ data: [{ workspace_id: "ws-1", role: "owner", workspace: { id: "ws-1", name: "Acme" } }], error: null })
        : chainable({ data: null, error: null }),
    );

    const historyRef = { current: [] as boolean[] };
    renderAuth(historyRef);
    await waitFor(() => expect(readState().membershipsLoading).toBe(false));
    expect(readState().memberships).toBe(1);

    const fetchCountBeforeRefresh = fromMock.mock.calls.length;
    // Everything from here on is the focus-triggered re-notification, past
    // the true initial-bootstrap loading period.
    const markerIndex = historyRef.current.length;

    act(() => {
      authChangeCallback("TOKEN_REFRESHED", makeSession("user-1"));
    });

    // membershipsLoading is set synchronously (before any await) when a
    // real reload happens, so a bug here shows up in this very render -
    // not just once the fetch eventually settles.
    expect(historyRef.current.slice(markerIndex)).not.toContain(true);

    // The refresh happened silently (memberships re-fetched)...
    await waitFor(() => expect(fromMock.mock.calls.length).toBeGreaterThan(fetchCountBeforeRefresh));
    // ...and membershipsLoading must never have been observed as true at
    // any point during it either.
    expect(historyRef.current.slice(markerIndex)).not.toContain(true);
    expect(readState().membershipsLoading).toBe(false);
    expect(readState().userId).toBe("user-1");
  });

  it("a real sign-in as a DIFFERENT user still shows the loading state", async () => {
    sessionPromise = Promise.resolve({ data: { session: { user: makeUser("user-1") } } });
    fromMock.mockImplementation((table: string) =>
      table === "workspace_members" ? chainable({ data: [], error: null }) : chainable({ data: null, error: null }),
    );

    renderAuth({ current: [] });
    await waitFor(() => expect(readState().membershipsLoading).toBe(false));

    let resolveSecondFetch!: () => void;
    fromMock.mockImplementation((table: string) => {
      if (table !== "workspace_members") return chainable({ data: null, error: null });
      const obj: Record<string, unknown> = {};
      obj.select = () => obj;
      obj.eq = () => obj;
      obj.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
        new Promise<{ data: unknown; error: unknown }>((resolve) => {
          resolveSecondFetch = () => resolve({ data: [], error: null });
        }).then(onFulfilled);
      return obj;
    });

    act(() => {
      authChangeCallback("SIGNED_IN", makeSession("user-2"));
    });

    await waitFor(() => expect(readState().membershipsLoading).toBe(true));
    expect(readState().userId).toBe("user-2");

    act(() => resolveSecondFetch());
    await waitFor(() => expect(readState().membershipsLoading).toBe(false));
  });
});
