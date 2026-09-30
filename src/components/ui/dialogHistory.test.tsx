// Device-QA defect H1: on phones, dialogs render as bottom sheets, so the
// device/browser Back button must close an open dialog before it navigates
// the page (previously Back left the page and destroyed the draft). Desktop
// centred modals must not touch history. Real BrowserRouter + jsdom's real,
// asynchronous History.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "./dialog";

// Controllable viewport for useMediaQuery.
let width = 390;
const listeners = new Set<() => void>();
const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  width = 390;
  window.matchMedia = ((query: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? NaN);
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? NaN);
    return {
      get matches() { return Number.isFinite(max) ? width <= max : Number.isFinite(min) ? width >= min : false; },
      media: query, onchange: null,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  window.history.replaceState(null, "", "/app");
});
afterEach(async () => {
  cleanup();
  listeners.clear();
  window.matchMedia = originalMatchMedia;
  await act(() => new Promise((r) => setTimeout(r, 30)));
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
const marked = () => !!(window.history.state as Record<string, unknown> | null)?.__sfOverlay;

// Same shape as NewLeadDialog / ComposePostDialog: controlled, draft reset on close.
function NewLeadLike() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setName(""); }}>
      <DialogTrigger asChild><button type="button">New lead</button></DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>New lead</DialogTitle>
        <label htmlFor="lead-name">Name</label>
        <input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} />
        <DialogFooter>
          <button type="button" onClick={() => setOpen(false)}>Save</button>
          <DialogClose asChild><button type="button">Cancel</button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Uncontrolled usage (DialogTrigger only) must work too.
function Uncontrolled() {
  return (
    <Dialog>
      <DialogTrigger asChild><button type="button">Open uncontrolled</button></DialogTrigger>
      <DialogContent aria-describedby={undefined}><DialogTitle>Uncontrolled</DialogTitle></DialogContent>
    </Dialog>
  );
}

function Path() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderApp() {
  render(
    <BrowserRouter>
      <Routes>
        <Route path="/app" element={<Link to="/app/leads">Leads</Link>} />
        <Route path="/app/leads" element={<><NewLeadLike /><Uncontrolled /></>} />
      </Routes>
      <Path />
    </BrowserRouter>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Leads" })); // Home -> Leads
  expect(screen.getByTestId("path")).toHaveTextContent("/app/leads");
}

const dialog = () => screen.queryByRole("dialog");
const openAndType = (text = "Thandi") => {
  fireEvent.click(screen.getByRole("button", { name: "New lead" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: text } });
};
const back = async () => {
  act(() => window.history.back());
  await settle();
};

describe("phone: Back closes an open dialog before navigating", () => {
  it("Back closes the dialog and stays on the page", async () => {
    renderApp();
    openAndType();
    expect(marked()).toBe(true);
    await back();
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(screen.getByTestId("path")).toHaveTextContent("/app/leads");
    expect(window.location.pathname).toBe("/app/leads");
  });

  it("a second Back then navigates the page normally", async () => {
    renderApp();
    openAndType();
    await back();
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await back();
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent(/^\/app$/));
  });

  it.each([["Save"], ["Cancel"]])("%s closes the dialog without leaving a stale history entry", async (button) => {
    renderApp();
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await settle();
    expect(marked()).toBe(false);
    // The very next Back is page navigation - there is no phantom step.
    await back();
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent(/^\/app$/));
  });

  it("Escape closes it without leaving a stale history entry", async () => {
    renderApp();
    openAndType();
    fireEvent.keyDown(dialog()!, { key: "Escape" });
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await settle();
    expect(marked()).toBe(false);
  });

  it("open -> close -> immediate reopen: a stale back() does not close the new dialog", async () => {
    renderApp();
    const realBack = window.history.back.bind(window.history);
    const held = vi.spyOn(window.history, "back").mockImplementation(() => {});
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New lead" })); // reopen while the back() is pending
    held.mockRestore();
    act(() => realBack()); // the stale traversal lands now
    await settle();
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/app/leads");
    await back();
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(screen.getByTestId("path")).toHaveTextContent("/app/leads");
  });

  it("works for uncontrolled dialogs too", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Open uncontrolled" }));
    expect(marked()).toBe(true);
    await back();
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(screen.getByTestId("path")).toHaveTextContent("/app/leads");
  });

  it("the draft is only reset by the dialog's own existing cancel behaviour (no autosave, no navigation)", async () => {
    renderApp();
    openAndType("Draft");
    await back();
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New lead" }));
    // NewLeadDialog resets on close - unchanged; the page never navigated.
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByTestId("path")).toHaveTextContent("/app/leads");
  });
});

describe("desktop (>= 640px): centred dialogs keep the existing history behaviour", () => {
  it("opening a dialog adds no history entry, and Back navigates the page as before", async () => {
    width = 1024;
    renderApp();
    const len = window.history.length;
    openAndType();
    expect(window.history.length).toBe(len);
    expect(marked()).toBe(false);
    await back();
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent(/^\/app$/));
  });
});
