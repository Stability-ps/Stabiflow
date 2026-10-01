// Regression guard: the mobile/PWA work must ORGANISE StabiFlow's modules on
// phones, never remove them. For a workspace entitled to every module:
//  - the desktop sidebar lists every origin/main module,
//  - on a phone each one is reachable via the bottom bar, More or the
//    Business hub,
//  - every module route stays registered regardless of viewport.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, createRoutesFromChildren, matchRoutes, type RouteObject } from "react-router-dom";
import type { ReactElement } from "react";
import { AppLayout } from "./AppLayout";
import { AppRoutes } from "@/App";
import { NAV_ITEMS } from "@/lib/navigation";

const flags = vi.hoisted(() => ({ on: [] as string[] }));
vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: (k: string) => flags.on.includes(k), isLoading: false, hasAdvancedModules: flags.on.length > 1 }),
}));
vi.mock("@/components/layout/AppHeader", () => ({ AppHeader: () => <header /> }));
vi.mock("@/components/layout/PlatformNotice", () => ({ PlatformNotice: () => null }));
vi.mock("@/components/layout/LegalReconsentBanner", () => ({ LegalReconsentBanner: () => null }));
vi.mock("@/components/layout/WorkspaceStatusBanner", () => ({ WorkspaceStatusBanner: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ signOut: vi.fn(), currentWorkspaceId: "ws-1" }) }));
vi.mock("@/hooks/useWorkspaceSwitch", () => ({
  useWorkspaceSwitch: () => ({ memberships: [], currentWorkspaceId: "ws-1", currentMembership: null, switchTo: vi.fn() }),
}));

// Exactly the production desktop sidebar for a fully entitled workspace.
const MAIN_MODULES = [
  "Home", "Business Studio", "My Business", "Documents", "Content", "Campaigns", "Creative Studio", "Messages", "Leads", "Customers",
  "Analytics", "Flow AI", "Automations", "Integrations", "Billing", "Settings",
];
const ALL_FLAGS = [
  "module.business_studio", "module.content", "module.campaigns", "module.creative_studio", "module.whatsapp", "module.leads", "module.customers",
  "module.analytics", "module.flow_ai", "module.automations", "module.integrations",
];
// Destinations the phone "Business" hub groups (see BusinessHub.tsx).
const BUSINESS_HUB = ["Business Studio", "My Business", "Documents"];

function renderLayout() {
  return render(<MemoryRouter initialEntries={["/app"]}><AppLayout /></MemoryRouter>);
}

describe("navigation parity with origin/main", () => {
  afterEach(() => {
    cleanup();
    flags.on = [];
  });

  it("NAV_ITEMS still defines every origin/main module", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(MAIN_MODULES);
  });

  it("DESKTOP: a fully entitled workspace gets the full sidebar", () => {
    flags.on = ALL_FLAGS;
    renderLayout();
    // jsdom is 1024px wide - the desktop sidebar, not the phone drawer.
    const sidebar = document.querySelector("[data-sidebar=sidebar]") as HTMLElement;
    expect(within(sidebar).getAllByRole("link").map((l) => l.textContent?.trim()).filter((t) => MAIN_MODULES.includes(t ?? ""))).toEqual(MAIN_MODULES);
  });

  it("PHONE: every module stays reachable through the bottom bar, More or the Business hub", () => {
    flags.on = ALL_FLAGS;
    renderLayout();
    const bar = screen.getByRole("navigation", { name: "Primary" });
    const tabs = within(bar).getAllByRole("link").map((l) => l.textContent);
    expect(tabs).toEqual(["Home", "Business", "Messages", "Leads"]);
    fireEvent.click(within(bar).getByRole("button", { name: "More destinations" }));
    const more = within(screen.getByRole("dialog", { name: "More" })).getByRole("navigation", { name: "More destinations" });
    const moreItems = within(more).getAllByRole("link").map((l) => l.textContent);
    const reachable = new Set([...tabs, ...moreItems, ...BUSINESS_HUB]);
    for (const module of MAIN_MODULES) expect(reachable, `${module} unreachable on phone`).toContain(module);
  });

  it("feature flags still decide visibility (nothing hard-coded on): a new non-Pro workspace matches origin/main", () => {
    flags.on = ["module.business_studio"];
    renderLayout();
    const sidebar = document.querySelector("[data-sidebar=sidebar]") as HTMLElement;
    expect(within(sidebar).getAllByRole("link").map((l) => l.textContent?.trim()).filter(Boolean)).toEqual(
      ["Home", "Business Studio", "My Business", "Documents", "Billing", "Settings"],
    );
  });

  it("every module route from origin/main is still registered (routing is viewport-independent)", () => {
    const routes = createRoutesFromChildren((AppRoutes() as ReactElement<{ children: ReactElement[] }>).props.children) as RouteObject[];
    const paths = [
      "/app/business-studio", "/app/business", "/app/documents", "/app/content/calendar", "/app/campaigns", "/app/campaigns/new", "/app/creative-studio",
      "/app/whatsapp/inbox", "/app/leads", "/app/customers", "/app/customers/c1", "/app/analytics", "/app/flow-ai", "/app/automations", "/app/integrations",
      "/app/billing", "/app/settings", "/app/business-hub",
    ];
    for (const path of paths) {
      const match = matchRoutes(routes, path);
      const leaf = match?.[match.length - 1]?.route.path;
      expect(leaf, `${path} is not registered`).toBeDefined();
      expect(leaf, `${path} fell through to a catch-all`).not.toMatch(/\*$/);
    }
  });
});
