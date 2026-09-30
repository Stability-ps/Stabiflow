// Review finding 9: closing an overlay schedules an (async) history.back().
// If the overlay is reopened before that lands, the resulting popstate must
// NOT close the new overlay. Uses jsdom's real, asynchronous History.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { useOverlayHistory } from "./useOverlayHistory";

let api: { open: () => void; close: () => void } = { open: () => {}, close: () => {} };

function Overlay() {
  const [open, setOpen] = useState(false);
  useOverlayHistory(open, () => setOpen(false));
  useEffect(() => {
    api = { open: () => setOpen(true), close: () => setOpen(false) };
  }, []);
  return <output data-testid="state">{open ? "open" : "closed"}</output>;
}

const state = () => screen.getByTestId("state").textContent;
const marked = () => !!(window.history.state as Record<string, unknown> | null)?.__sfOverlay;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

function mount() {
  return render(<MemoryRouter><Overlay /></MemoryRouter>);
}

describe("useOverlayHistory", () => {
  beforeEach(() => {
    // Every test starts on a clean, non-overlay entry.
    window.history.replaceState(null, "");
  });
  afterEach(async () => {
    cleanup();
    await settle();
  });

  it("device Back closes the current overlay", async () => {
    mount();
    act(() => api.open());
    expect(marked()).toBe(true);
    act(() => window.history.back());
    await waitFor(() => expect(state()).toBe("closed"));
    expect(marked()).toBe(false);
  });

  it("closing another way pops its own history entry (no dead Back step)", async () => {
    mount();
    act(() => api.open());
    const withOverlay = window.history.length;
    act(() => api.close());
    await settle();
    expect(marked()).toBe(false);
    // Reopening reuses the popped slot: the stack does not keep growing.
    act(() => api.open());
    expect(window.history.length).toBe(withOverlay);
  });

  it("open -> close -> immediate reopen: the stale back() does not close the new overlay", async () => {
    mount();
    act(() => api.open());
    act(() => api.close()); // schedules history.back() (async)
    act(() => api.open()); // separate render, before that back() has landed
    await settle(); // the stale popstate fires now
    expect(state()).toBe("open");
    // ...and the new overlay has its own entry, so Back still closes it.
    expect(marked()).toBe(true);
    act(() => window.history.back());
    await waitFor(() => expect(state()).toBe("closed"));
  });

  it("a stale back() that lands AFTER a rapid reopen (spec/Chrome ordering) does not close the new overlay", async () => {
    mount();
    // Hold the close's back() so it runs after the reopen, as browsers that
    // queue the traversal do.
    const realBack = window.history.back.bind(window.history);
    const held = vi.spyOn(window.history, "back").mockImplementation(() => {});
    act(() => api.open());
    act(() => api.close());
    expect(held).toHaveBeenCalledTimes(1);
    act(() => api.open()); // reopen while that back() is still pending
    held.mockRestore();
    act(() => realBack()); // ...now the stale traversal lands
    await settle();
    expect(state()).toBe("open");
    expect(marked()).toBe(true);
    // The user's real Back still closes it, leaving no overlay entry behind.
    act(() => window.history.back());
    await waitFor(() => expect(state()).toBe("closed"));
    expect(marked()).toBe(false);
  });

  it("a Back that lands on a stale overlay entry (e.g. left by a reload) is still recognised as ours", async () => {
    window.history.replaceState({ __sfOverlay: "stale:1" }, ""); // reload happened on an overlay entry
    mount();
    act(() => api.open());
    act(() => api.close()); // our back() lands on that marked entry
    await settle();
    act(() => api.open());
    act(() => window.history.back()); // the user's Back must close it
    await waitFor(() => expect(state()).toBe("closed"));
  });

  it("repeated open/close cycles do not leak popstate listeners or history entries", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = mount();
    act(() => api.open());
    const withOverlay = window.history.length;
    act(() => api.close());
    await settle();
    for (let i = 0; i < 10; i++) {
      act(() => api.open());
      act(() => api.close());
      await settle();
    }
    act(() => api.open());
    expect(window.history.length).toBe(withOverlay);
    const pop = (spy: typeof add) => spy.mock.calls.filter(([t]) => t === "popstate").length;
    expect(pop(add)).toBe(1);
    unmount();
    expect(pop(remove)).toBe(1);
    add.mockRestore();
    remove.mockRestore();
  });
});
