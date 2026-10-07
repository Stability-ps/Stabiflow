import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { NAV_ITEMS, NAV_SECTIONS, type NavItem } from "@/lib/navigation";
import { AppSidebar } from "./AppSidebar";

const billing = vi.hoisted(() => ({
  fetchBillingState: vi.fn(),
}));
const admin = vi.hoisted(() => ({ allowed: false }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    currentWorkspaceId: "workspace-1",
    currentMembership: { role: "owner", workspace: { name: "Ubuntu Bakery & Catering Co-operative (Pty) Ltd" } },
    memberships: [{ workspaceId: "workspace-1", role: "owner", workspace: { name: "Ubuntu Bakery & Catering Co-operative (Pty) Ltd" } }],
    setCurrentWorkspaceId: vi.fn(),
  }),
}));
vi.mock("@/lib/billing", async (orig) => ({ ...(await orig<typeof import("@/lib/billing")>()), fetchBillingState: billing.fetchBillingState }));
vi.mock("@/lib/adminApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/adminApi")>()),
  adminConsole: async () => {
    if (admin.allowed) return { userId: "user-1" };
    const { AdminApiError } = await orig<typeof import("@/lib/adminApi")>();
    throw new AdminApiError("forbidden", 403, null);
  },
}));

const FREE = { subscription: null, purchases: [], transactions: [] };
const GROWTH = {
  subscription: { id: "s1", status: "active", current_period_end: null, grace_until: null, cancel_at_period_end: false, plan: { code: "growth", name: "Growth" }, price: null },
  purchases: [],
  transactions: [],
};

function renderSidebar(path: string, opts: { items?: NavItem[]; lockedItems?: NavItem[]; collapsed?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <SidebarProvider defaultOpen={!opts.collapsed}>
          <AppSidebar items={opts.items} lockedItems={opts.lockedItems} />
        </SidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const byLabel = (label: string) => NAV_ITEMS.find((i) => i.label === label)!;

beforeEach(() => {
  document.cookie = "sidebar:state=; max-age=0; path=/";
  billing.fetchBillingState.mockReset().mockResolvedValue(GROWTH);
  admin.allowed = false;
});
afterEach(cleanup);

describe("AppSidebar active state", () => {
  it.each([
    ["Home", "/app"], ["Content", "/app/content"], ["Campaigns", "/app/campaigns"],
    ["Creative Studio", "/app/creative-studio"], ["Messages", "/app/whatsapp/inbox"], ["Leads", "/app/leads"],
    ["Analytics", "/app/analytics"], ["Flow AI", "/app/flow-ai"], ["Automations", "/app/automations"],
    ["Integrations", "/app/integrations"], ["Billing", "/app/billing"], ["Settings", "/app/settings"],
  ])("marks %s as the accessible current page", (label, path) => {
    renderSidebar(path);
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page")).toHaveLength(1);
  });

  it.each([
    ["Campaigns", "/app/campaigns/new"],
    ["Content", "/app/content/calendar"],
    ["Settings", "/app/settings/members"],
  ])("keeps %s selected on nested route %s", (label, path) => {
    renderSidebar(path);
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it.each(["/app/whatsapp/inbox", "/app/whatsapp/contacts", "/app/whatsapp/templates", "/app/whatsapp/settings"])(
    "keeps the single Messages item selected on every Messages page (%s)",
    (path) => {
      renderSidebar(path);
      expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    },
  );

  // a7d4580 removed the duplicate Messages child links from the sidebar:
  // Inbox, Contacts, Templates, Intake and Analytics are page-level tabs
  // inside Messages (WhatsAppLayout), not global navigation.
  it("does not duplicate the Messages page tabs in the global sidebar", () => {
    renderSidebar("/app/whatsapp/inbox");
    for (const name of ["Messages Inbox", "Messages Contacts", "Messages Templates", "Messages Analytics", "Messages Automations"]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
  });
});

describe("AppSidebar sections", () => {
  it("uses plain section labels (not collapsible group buttons) with each module under its section", () => {
    renderSidebar("/app");
    for (const section of NAV_SECTIONS) {
      expect(screen.queryByRole("button", { name: section.label })).not.toBeInTheDocument();
      const group = screen.getByRole("group", { name: section.label });
      for (const path of section.paths) {
        const item = NAV_ITEMS.find((i) => i.path === path)!;
        expect(within(group).getByRole("link", { name: item.label })).toBeInTheDocument();
      }
    }
  });

  it("keeps Home, Guide, Billing and Settings directly reachable outside the sections", () => {
    renderSidebar("/app");
    for (const name of ["Home", "Guide", "Billing", "Settings"]) expect(screen.getByRole("link", { name })).toBeInTheDocument();
  });

  it("preserves every route: each nav item links to its existing destination", () => {
    renderSidebar("/app");
    for (const item of NAV_ITEMS) {
      const expected = item.path === "/app/whatsapp" ? "/app/whatsapp/inbox" : item.path;
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute("href", expected);
    }
  });

  it("drops a section entirely when none of its modules are visible or locked", () => {
    const launch = NAV_ITEMS.filter((i) => !i.flag || i.flag === "module.business_studio");
    renderSidebar("/app", { items: launch });
    expect(screen.getByRole("group", { name: "Business" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Insights" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();
  });
});

describe("AppSidebar plan-locked modules", () => {
  const visible = NAV_ITEMS.filter((i) => i.label !== "Flow AI" && i.label !== "Campaigns");
  const locked = [byLabel("Campaigns"), byLabel("Flow AI")];

  it("shows plan-locked modules in their section with a lock explanation instead of hiding them", () => {
    renderSidebar("/app", { items: visible, lockedItems: locked });
    const link = screen.getByRole("link", { name: /Flow AI \(locked\)/ });
    expect(link).toHaveAccessibleName("Flow AI (locked). Included in the Growth plan. View upgrade options");
    expect(link).toHaveAttribute("data-locked", "true");
    expect(within(screen.getByRole("group", { name: "Insights" })).getByRole("link", { name: /Flow AI/ })).toBe(link);
    expect(within(screen.getByRole("group", { name: "Marketing" })).getByRole("link", { name: /Campaigns \(locked\)/ })).toBeInTheDocument();
  });

  it("the upgrade action is the module's own gated route, where FeatureGate shows the existing upgrade screen", () => {
    renderSidebar("/app", { items: visible, lockedItems: locked });
    expect(screen.getByRole("link", { name: /Flow AI \(locked\)/ })).toHaveAttribute("href", "/app/flow-ai");
  });

  it("marks a locked module current while its upgrade screen is open", () => {
    renderSidebar("/app/flow-ai", { items: visible, lockedItems: locked });
    expect(screen.getByRole("link", { name: /Flow AI \(locked\)/ })).toHaveAttribute("aria-current", "page");
  });

  it("modules hidden for other reasons stay hidden (not passed as locked)", () => {
    renderSidebar("/app", { items: visible, lockedItems: [] });
    expect(screen.queryByRole("link", { name: /Flow AI/ })).not.toBeInTheDocument();
  });
});

describe("AppSidebar workspace plan (billing state)", () => {
  const planText = () => screen.getByTestId("workspace-switcher").querySelector("[data-plan-status]");

  it("shows 'Checking plan…' while billing state loads - never 'Free'", () => {
    billing.fetchBillingState.mockReturnValue(new Promise(() => {}));
    renderSidebar("/app");
    expect(planText()).toHaveTextContent("Checking plan…");
    expect(planText()).toHaveAttribute("data-plan-status", "loading");
  });

  it("shows 'Plan unavailable' when billing state fails to load - never 'Free'", async () => {
    billing.fetchBillingState.mockRejectedValue(new Error("network down"));
    renderSidebar("/app");
    expect(await screen.findByText("Plan unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/Free plan/)).not.toBeInTheDocument();
  });

  it("shows 'Free plan' only when billing confirms no subscription or purchase", async () => {
    billing.fetchBillingState.mockResolvedValue(FREE);
    renderSidebar("/app");
    expect(await screen.findByText("Free plan")).toBeInTheDocument();
  });

  it("shows the confirmed paid plan name", async () => {
    renderSidebar("/app");
    expect(await screen.findByText("Growth plan")).toBeInTheDocument();
  });

  it("keeps long workspace names truncated but fully available", () => {
    renderSidebar("/app");
    const name = screen.getByTitle("Ubuntu Bakery & Catering Co-operative (Pty) Ltd");
    expect(name).toHaveClass("truncate");
    expect(screen.getByTestId("workspace-switcher")).toHaveAccessibleName(/Workspace: Ubuntu Bakery & Catering Co-operative \(Pty\) Ltd/);
  });
});

describe("AppSidebar collapsed, search and staff links", () => {
  it("collapses to an icon rail that keeps every destination's accessible name and the current page", () => {
    renderSidebar("/app/leads", { collapsed: true });
    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByTestId("workspace-switcher")).toBeInTheDocument();
  });

  it("keeps plan-locked modules identifiable on the collapsed rail (lock badge + locked name)", () => {
    renderSidebar("/app", { collapsed: true, items: NAV_ITEMS.filter((i) => i.label !== "Flow AI"), lockedItems: [byLabel("Flow AI")] });
    const locked = screen.getByRole("link", { name: /Flow AI \(locked\)/ });
    expect(within(locked).getByTestId("lock-indicator")).toBeInTheDocument();
  });

  it("restores the last collapsed/expanded choice from the sidebar cookie", () => {
    document.cookie = "sidebar:state=false; path=/";
    renderSidebar("/app");
    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull();
  });

  it("persists the toggle: collapsing writes the sidebar cookie and the next load starts collapsed", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/app"]}>
          <SidebarProvider><SidebarTrigger /><AppSidebar /></SidebarProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(tree());
    const trigger = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(trigger);
    expect(document.cookie).toMatch(/sidebar:state=false/);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
    cleanup();
    render(tree());
    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(document.cookie).toMatch(/sidebar:state=true/);
  });

  it("collapsed rows show their label as a tooltip on keyboard focus", async () => {
    renderSidebar("/app", { collapsed: true });
    fireEvent.focus(screen.getByRole("link", { name: "Leads" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Leads");
  });

  it("opens 'Search or jump to…' and navigates by keyboard", () => {
    renderSidebar("/app");
    fireEvent.click(screen.getByRole("button", { name: /Search or jump to/ }));
    const input = screen.getByRole("combobox", { name: "Search pages and settings" });
    fireEvent.change(input, { target: { value: "templ" } });
    expect(screen.getByRole("option", { name: /Messages › Templates/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("combobox", { name: "Search pages and settings" })).not.toBeInTheDocument();
  });

  it("opens the jump menu with Cmd/Ctrl+K", () => {
    renderSidebar("/app");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("combobox", { name: "Search pages and settings" })).toBeInTheDocument();
  });

  it("shows the Admin console link only to authorised staff", async () => {
    renderSidebar("/app");
    expect(screen.queryByRole("link", { name: "Admin console" })).not.toBeInTheDocument();
    cleanup();
    admin.allowed = true;
    renderSidebar("/app");
    expect(await screen.findByRole("link", { name: "Admin console" })).toHaveAttribute("href", "/admin");
  });
});
