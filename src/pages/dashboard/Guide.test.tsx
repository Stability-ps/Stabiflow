import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Guide from "@/pages/dashboard/Guide";
import { resetGuideProgressCache } from "@/hooks/useGuideProgress";
import type { FeatureFlagKey } from "@/lib/featureFlags";

const enabledFlags = new Set<FeatureFlagKey>();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, currentWorkspaceId: "ws-1" }),
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: (k: FeatureFlagKey) => enabledFlags.has(k), isLoading: false, hasAdvancedModules: enabledFlags.size > 0 }),
}));

const upsert = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/integrations/supabase/client", () => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: null }), upsert: (...args: unknown[]) => upsert(...args) };
  return { supabase: { from: () => chain } };
});

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{`${loc.pathname}${loc.hash}`}</output>;
}

function renderGuide(path = "/app/guide") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/app/guide/*" element={<Guide />} /><Route path="*" element={null} /></Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  enabledFlags.clear();
  localStorage.clear();
  resetGuideProgressCache();
  upsert.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(cleanup);

describe("Guide home", () => {
  it("explains StabiFlow and links every journey stage to its chapter", () => {
    renderGuide();
    expect(screen.getByRole("heading", { name: "What is StabiFlow?" })).toBeInTheDocument();
    const journey = screen.getByRole("heading", { name: "How StabiFlow works" }).parentElement!;
    expect(within(journey).getByRole("link", { name: /Communicate on WhatsApp/ })).toHaveAttribute("href", "/app/guide/messages");
    expect(within(journey).getAllByRole("link")).toHaveLength(8);
  });

  it("is available even when no advanced modules are enabled", () => {
    renderGuide("/app/guide/messages");
    expect(screen.getByRole("heading", { level: 1, name: "Messages (WhatsApp)" })).toBeInTheDocument();
    expect(screen.getByText(/isn't switched on for your workspace yet/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Open Messages/ })).not.toBeInTheDocument();
  });

  it("offers the product shortcut when the module is enabled", () => {
    enabledFlags.add("module.whatsapp");
    renderGuide("/app/guide/messages");
    expect(screen.queryByText(/isn't switched on for your workspace yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Messages/ })).toHaveAttribute("href", "/app/whatsapp/inbox");
  });
});

describe("Guide chapters", () => {
  it("renders a chapter with availability, last updated and sections", () => {
    renderGuide("/app/guide/billing");
    expect(screen.getByRole("heading", { level: 1, name: "Billing & plans" })).toBeInTheDocument();
    expect(screen.getByText("All plans")).toBeInTheDocument();
    expect(screen.getByText(/Last updated: 6 October 2026/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Upgrading and paying" })).toBeInTheDocument();
  });

  it("navigates to the next chapter and marks the current one read", async () => {
    renderGuide("/app/guide/welcome");
    fireEvent.click(screen.getByRole("link", { name: /Next\s*Getting started/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/app/guide/getting-started"));
    expect(screen.getByText("1 of 23 chapters read")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /Previous\s*Welcome to StabiFlow/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/app/guide/welcome"));
  });

  it("toggles Mark as read and persists it per user", () => {
    renderGuide("/app/guide/leads");
    fireEvent.click(screen.getByRole("button", { name: /Mark as read/ }));
    expect(screen.getByRole("button", { name: /^Read$/ })).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(localStorage.getItem("stabiflow.guide.read.user-1") ?? "[]")).toContain("leads");
  });

  it("scrolls deep links to the requested section", async () => {
    renderGuide("/app/guide/messages#templates");
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    const target = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts.at(-1) as HTMLElement;
    expect(target.id).toBe("templates");
  });

  it("shows a friendly not-found state for unknown articles", () => {
    renderGuide("/app/guide/not-a-real-chapter");
    expect(screen.getByText("Guide article not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the guide" })).toHaveAttribute("href", "/app/guide");
  });

  it("expands FAQ answers", () => {
    renderGuide("/app/guide/faq");
    const summary = screen.getByText("What is the difference between Leads and Customers?");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
  });

  it("saves Was this helpful? feedback for the article", async () => {
    renderGuide("/app/guide/leads");
    fireEvent.click(screen.getByRole("button", { name: /^Helpful$/ }));
    await waitFor(() => expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-1", article_slug: "leads", workspace_id: "ws-1", helpful: true },
      { onConflict: "user_id,article_slug" },
    ));
    expect(screen.getByText("Thanks - glad it helped.")).toBeInTheDocument();
  });
});

describe("Guide screenshots", () => {
  it("opens a larger view in an accessible dialog and closes it", async () => {
    renderGuide("/app/guide/leads");
    fireEvent.click(screen.getAllByRole("button", { name: /^Enlarge screenshot/ })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", expect.stringMatching(/^\/help\/screenshots\/.+\.webp$/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("Guide search", () => {
  it("finds a section and jumps straight to it", async () => {
    renderGuide();
    const input = screen.getByRole("combobox", { name: "Search the guide" });
    fireEvent.change(input, { target: { value: "StabiFlow Library" } });
    const listbox = await screen.findByRole("listbox", { name: "Search results" });
    expect(within(listbox).getAllByRole("option").length).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/app/guide/messages#library"));
  });

  it("focuses search with / and clears with Escape", () => {
    renderGuide();
    fireEvent.keyDown(window, { key: "/" });
    const input = screen.getByRole("combobox", { name: "Search the guide" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "payment" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
  });

  it("tells the reader when nothing matches", async () => {
    renderGuide();
    fireEvent.change(screen.getByRole("combobox", { name: "Search the guide" }), { target: { value: "zzqxv" } });
    expect(await screen.findByText(/No results for "zzqxv"/)).toBeInTheDocument();
  });
});

describe("Guide mobile chapter navigation", () => {
  it("expands the chapter list and navigates", async () => {
    renderGuide("/app/guide/billing");
    const nav = screen.getByTestId("guide-mobile-nav");
    const toggle = within(nav).getByRole("button", { name: /17\. Billing & plans/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(nav).getByRole("link", { name: /11\. Leads/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/app/guide/leads"));
    expect(within(screen.getByTestId("guide-mobile-nav")).getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });
});
