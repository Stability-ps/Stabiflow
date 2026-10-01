import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { filterNavItems, type FeatureFlagKey } from "@/lib/featureFlags";
import { NAV_ITEMS } from "@/lib/navigation";
import { MobileBottomNav } from "./MobileBottomNav";

const signOut = vi.fn();
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ signOut }) }));
vi.mock("@/hooks/useWorkspaceSwitch", () => ({
  useWorkspaceSwitch: () => ({
    memberships: [{ workspaceId: "w1", role: "owner", workspace: { name: "Acme Plumbing" } }],
    currentWorkspaceId: "w1",
    currentMembership: { workspaceId: "w1", role: "owner", workspace: { name: "Acme Plumbing" } },
    switchTo: vi.fn(),
  }),
}));

const ALL_FLAGS: FeatureFlagKey[] = ["module.business_studio", "module.content", "module.campaigns", "module.creative_studio", "module.whatsapp", "module.leads", "module.customers", "module.analytics", "module.flow_ai", "module.automations", "module.integrations"];

// Records every location the router commits, so tests can assert on the
// exact number of navigations (no double navigation).
const visited: string[] = [];
function LocationProbe() {
  const loc = useLocation();
  if (visited[visited.length - 1] !== `${loc.key}|${loc.pathname}`) visited.push(`${loc.key}|${loc.pathname}`);
  return <output data-testid="path">{loc.pathname}</output>;
}

// AppLayout passes the feature-flag filtered list - the same one the sidebar gets.
function renderNav(path: string, flags: FeatureFlagKey[] = ALL_FLAGS) {
  visited.length = 0;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileBottomNav items={filterNavItems(NAV_ITEMS, (k) => flags.includes(k))} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const nav = () => screen.getByRole("navigation", { name: "Primary" });
const openMore = () => fireEvent.click(within(nav()).getByRole("button", { name: "More destinations" }));
const sheet = () => screen.queryByRole("dialog", { name: "More" });

describe("MobileBottomNav", () => {
  afterEach(cleanup);

  it("renders the five primary destinations with accessible labels and touch-size targets", () => {
    renderNav("/app");
    const links = within(nav()).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Home", "Business", "WhatsApp", "Leads"]);
    expect(within(nav()).getByRole("button", { name: "More destinations" })).toBeInTheDocument();
    for (const el of [...links, within(nav()).getByRole("button", { name: "More destinations" })]) expect(el.className).toContain("min-h-12");
  });

  it.each([
    ["/app", "Home"],
    ["/app/business-hub", "Business"],
    ["/app/business-studio", "Business"],
    ["/app/business", "Business"],
    ["/app/documents", "Business"],
    ["/app/whatsapp/inbox", "WhatsApp"],
    ["/app/leads", "Leads"],
  ])("marks exactly one tab as the current page at %s", (path, label) => {
    renderNav(path);
    const current = within(nav()).getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual([label]);
  });

  it("highlights More when the current page lives in the More sheet", () => {
    renderNav("/app/settings");
    expect(within(nav()).getAllByRole("link").some((l) => l.getAttribute("aria-current") === "page")).toBe(false);
    expect(within(nav()).getByRole("button", { name: "More destinations" })).toHaveAttribute("data-active", "true");
  });

  it("respects feature flags: a Business Studio-only workspace has no WhatsApp or Leads tab", () => {
    renderNav("/app", ["module.business_studio"]);
    expect(within(nav()).getAllByRole("link").map((l) => l.textContent)).toEqual(["Home", "Business"]);
    openMore();
    const items = within(sheet()!).getByRole("navigation", { name: "More destinations" });
    expect(within(items).getAllByRole("link").map((l) => l.textContent)).toEqual(["Documents", "Billing", "Settings"]);
  });

  it("More opens a bottom sheet with every secondary destination and locks body scroll", () => {
    renderNav("/app");
    openMore();
    expect(sheet()).toBeInTheDocument();
    const items = within(sheet()!).getByRole("navigation", { name: "More destinations" });
    expect(within(items).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Documents", "Content", "Campaigns", "Creative Studio", "Customers", "Analytics", "Flow AI", "Automations", "Integrations", "Billing", "Settings",
    ]);
    expect(document.body).toHaveAttribute("data-scroll-locked");
  });

  it("selecting a More item navigates once, closes the sheet, removes the overlay and restores scrolling", async () => {
    renderNav("/app");
    openMore();
    const before = visited.length;
    fireEvent.click(within(sheet()!).getByRole("link", { name: "Settings" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/app/settings");
    await waitFor(() => expect(sheet()).not.toBeInTheDocument());
    expect(screen.queryByTestId("bottom-sheet-overlay")).not.toBeInTheDocument();
    expect(document.body).not.toHaveAttribute("data-scroll-locked");
    expect(visited.length - before).toBe(1);
  });

  it.each(["Documents", "Content", "Campaigns", "Creative Studio", "Customers", "Analytics", "Flow AI", "Automations", "Integrations", "Billing", "Settings"])(
    "closes after navigating to %s",
    async (label) => {
      renderNav("/app");
      openMore();
      fireEvent.click(within(sheet()!).getByRole("link", { name: label }));
      await waitFor(() => expect(sheet()).not.toBeInTheDocument());
      expect(screen.getByTestId("path").textContent).not.toBe("/app");
    },
  );

  it("closes on Escape", async () => {
    renderNav("/app");
    openMore();
    fireEvent.keyDown(sheet()!, { key: "Escape" });
    await waitFor(() => expect(sheet()).not.toBeInTheDocument());
    expect(screen.getByTestId("path")).toHaveTextContent("/app");
  });

  it("closes when the backdrop is tapped", async () => {
    renderNav("/app");
    openMore();
    // Radix registers its outside-pointer listener on the next tick.
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const overlay = screen.getByTestId("bottom-sheet-overlay");
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    await waitFor(() => expect(sheet()).not.toBeInTheDocument());
  });

  it("the device/browser Back button closes the sheet instead of leaving the page", async () => {
    renderNav("/app/leads");
    openMore();
    act(() => {
      // A real Back: the browser leaves the overlay's history entry.
      window.history.back();
    });
    await waitFor(() => expect(sheet()).not.toBeInTheDocument());
    expect(screen.getByTestId("path")).toHaveTextContent("/app/leads");
  });
});

describe("MobileBottomNav layout", () => {
  afterEach(cleanup);
  it("is phone-only, fixed to the bottom and clears the home indicator", () => {
    renderNav("/app");
    expect(nav().className).toMatch(/\bfixed\b/);
    expect(nav().className).toContain("bottom-0");
    expect(nav().className).toContain("md:hidden");
    expect(nav().className).toContain("pb-[env(safe-area-inset-bottom)]");
  });
});
