import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

function renderSidebar(path: string) {
  render(<MemoryRouter initialEntries={[path]}><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
}

const mobileMock = vi.hoisted(() => ({ isMobile: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobileMock.isMobile }));

function renderMobileSidebarWithTrigger(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <SidebarTrigger />
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe("AppSidebar active state", () => {
  afterEach(cleanup);

  it.each([
    ["Home", "/app"], ["Business", "/app/business-overview"], ["Messages", "/app/whatsapp/inbox"],
    ["Marketing", "/app/marketing-overview"], ["Automations", "/app/automations"],
    ["Analytics", "/app/analytics"], ["Settings", "/app/settings"],
  ])("marks %s as the accessible current page", (label, path) => {
    renderSidebar(path);
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  });

  it.each([
    ["Business", "/app/customers"],
    ["Business", "/app/leads"],
    ["Business", "/app/business-studio"],
    ["Marketing", "/app/content/calendar"],
    ["Marketing", "/app/campaigns/new"],
    ["Automations", "/app/flow-ai"],
    ["Settings", "/app/settings/members"],
  ])("keeps %s selected on nested/child route %s", (label, path) => {
    renderSidebar(path);
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it.each([
    ["/app/whatsapp/inbox", "Messages Inbox"],
    ["/app/whatsapp/contacts", "Messages Contacts"],
    ["/app/whatsapp/templates", "Messages Templates"],
    ["/app/whatsapp/settings", "Messages Settings"],
  ])("keeps the Messages parent selected and marks the child at %s", (path, childName) => {
    renderSidebar(path);
    // The single "Messages" parent stays selected across every WhatsApp
    // child page - WhatsApp itself is preserved as the section's content.
    expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: childName })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("exposes each section's child navigation only while inside that section", () => {
    renderSidebar("/app/analytics");
    expect(screen.queryByRole("link", { name: "Messages Contacts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Business Customers" })).not.toBeInTheDocument();
    cleanup();
    renderSidebar("/app/whatsapp/inbox");
    expect(screen.getByRole("link", { name: "Messages Contacts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Messages Templates" })).toBeInTheDocument();
    cleanup();
    renderSidebar("/app/customers");
    expect(screen.getByRole("link", { name: "Business Customers" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Business Leads" })).toBeInTheDocument();
  });

  it("links the Messages sub-nav Automations into the shared module with a WhatsApp filter, and Analytics to the WhatsApp-owned page", () => {
    renderSidebar("/app/whatsapp/inbox");
    expect(screen.getByRole("link", { name: "Messages Automations" })).toHaveAttribute("href", "/app/automations?trigger=conversation");
    expect(screen.getByRole("link", { name: "Messages Analytics" })).toHaveAttribute("href", "/app/whatsapp/analytics");
  });

  it("groups business-management pages under Business, including reserved (unbuilt) Invoices/Quotes entries", () => {
    renderSidebar("/app/business-overview");
    expect(screen.getByRole("link", { name: "Business My Business" })).toHaveAttribute("href", "/app/business");
    expect(screen.getByRole("link", { name: "Business Documents" })).toHaveAttribute("href", "/app/documents");
    // Reserved for the future invoicing module - the component itself
    // renders whatever NAV_ITEMS contains; feature-flag filtering happens
    // upstream in AppLayout via filterNavItems (see featureFlags.test.ts),
    // not inside AppSidebar.
    expect(screen.getByRole("link", { name: "Business Invoices" })).toHaveAttribute("href", "/app/invoices");
    expect(screen.getByRole("link", { name: "Business Quotes" })).toHaveAttribute("href", "/app/quotes");
  });

  it("groups Content, Campaigns and Creative Studio under Marketing", () => {
    renderSidebar("/app/marketing-overview");
    expect(screen.getByRole("link", { name: "Marketing Content" })).toHaveAttribute("href", "/app/content");
    expect(screen.getByRole("link", { name: "Marketing Campaigns" })).toHaveAttribute("href", "/app/campaigns");
    expect(screen.getByRole("link", { name: "Marketing Creative Studio" })).toHaveAttribute("href", "/app/creative-studio");
  });

  it("nests Flow AI inside Automations instead of the top level", () => {
    renderSidebar("/app/automations");
    expect(screen.getByRole("link", { name: "Automations Flow AI" })).toHaveAttribute("href", "/app/flow-ai");
    // No bare top-level "Flow AI" item - it only exists as the prefixed child link above.
    expect(screen.queryByRole("link", { name: "Flow AI" })).not.toBeInTheDocument();
  });

  it("no longer shows Billing or Integrations as top-level sidebar destinations", () => {
    renderSidebar("/app");
    expect(screen.queryByRole("link", { name: "Billing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Integrations" })).not.toBeInTheDocument();
  });

  it("on mobile, closes the sidebar sheet after picking a destination", () => {
    mobileMock.isMobile = true;
    try {
      renderMobileSidebarWithTrigger("/app");
      fireEvent.click(screen.getByRole("button", { name: /toggle sidebar/i }));
      const businessLink = screen.getByRole("link", { name: "Business" });
      expect(businessLink).toBeInTheDocument();
      fireEvent.click(businessLink);
      // SidebarProvider's mobile state lives above the router Outlet and
      // survives navigation - without closing it on click, the sheet would
      // still cover the destination page.
      expect(screen.queryByRole("link", { name: "Business" })).not.toBeInTheDocument();
    } finally {
      mobileMock.isMobile = false;
    }
  });
});
