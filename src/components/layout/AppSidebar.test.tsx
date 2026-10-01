import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

function renderSidebar(path: string) {
  render(<MemoryRouter initialEntries={[path]}><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
}

describe("AppSidebar active state", () => {
  afterEach(cleanup);

  it.each([
    ["Home", "/app"], ["Content", "/app/content"], ["Campaigns", "/app/campaigns"],
    ["Creative Studio", "/app/creative-studio"], ["WhatsApp", "/app/whatsapp/inbox"], ["Leads", "/app/leads"],
    ["Analytics", "/app/analytics"], ["Flow AI", "/app/flow-ai"], ["Automations", "/app/automations"],
    ["Integrations", "/app/integrations"], ["Settings", "/app/settings"],
  ])("marks %s as the accessible current page", (label, path) => {
    renderSidebar(path);
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
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

  it.each([
    ["/app/whatsapp/inbox", "WhatsApp Inbox"],
    ["/app/whatsapp/contacts", "WhatsApp Contacts"],
    ["/app/whatsapp/templates", "WhatsApp Templates"],
    ["/app/whatsapp/settings", "WhatsApp Settings"],
  ])("keeps the WhatsApp parent selected and marks the child at %s", (path, childName) => {
    renderSidebar(path);
    // The single "WhatsApp" parent stays selected across every child page.
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("aria-current", "page");
    // ...and the specific child route is marked current too.
    expect(screen.getByRole("link", { name: childName })).toHaveAttribute("aria-current", "page");
    // No cross-contamination with the top-level items.
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("exposes the WhatsApp child navigation only while inside the section", () => {
    renderSidebar("/app/leads");
    expect(screen.queryByRole("link", { name: "WhatsApp Contacts" })).not.toBeInTheDocument();
    cleanup();
    renderSidebar("/app/whatsapp/inbox");
    expect(screen.getByRole("link", { name: "WhatsApp Contacts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "WhatsApp Templates" })).toBeInTheDocument();
  });

  it("links the WhatsApp sub-nav Automations into the shared module with a WhatsApp filter, and Analytics to the WhatsApp-owned page", () => {
    renderSidebar("/app/whatsapp/inbox");
    expect(screen.getByRole("link", { name: "WhatsApp Automations" })).toHaveAttribute("href", "/app/automations?trigger=conversation");
    // Phase 11: WhatsApp Analytics is now its own operational page inside
    // the WhatsApp section, not a filtered link into global Analytics.
    expect(screen.getByRole("link", { name: "WhatsApp Analytics" })).toHaveAttribute("href", "/app/whatsapp/analytics");
  });
});

// Regression: on phones the sidebar is a modal drawer. Tapping a destination
// used to navigate while leaving the drawer (and its overlay + scroll lock)
// open on top of the new page.
describe("AppSidebar mobile drawer", () => {
  const originalWidth = window.innerWidth;
  function PathProbe() {
    return <output data-testid="path">{useLocation().pathname}</output>;
  }
  async function renderMobileDrawer(path: string) {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 375 });
    render(
      <MemoryRouter initialEntries={[path]}>
        <SidebarProvider>
          <SidebarTrigger />
          <AppSidebar />
          <PathProbe />
        </SidebarProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    return waitFor(() => screen.getByRole("dialog"));
  }
  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: originalWidth });
  });

  it.each([
    ["Home", "/app"], ["Business Studio", "/app/business-studio"], ["My Business", "/app/business"], ["Documents", "/app/documents"],
    ["Content", "/app/content"], ["Campaigns", "/app/campaigns"], ["Creative Studio", "/app/creative-studio"], ["WhatsApp", "/app/whatsapp"],
    ["Leads", "/app/leads"], ["Customers", "/app/customers"], ["Analytics", "/app/analytics"], ["Flow AI", "/app/flow-ai"],
    ["Automations", "/app/automations"], ["Integrations", "/app/integrations"], ["Billing", "/app/billing"], ["Settings", "/app/settings"],
  ])("selecting %s navigates and fully closes the drawer", async (label, to) => {
    const drawer = await renderMobileDrawer(label === "Home" ? "/app/settings" : "/app");
    expect(document.body).toHaveAttribute("data-scroll-locked");
    fireEvent.click(within(drawer).getByRole("link", { name: label }));
    expect(screen.getByTestId("path")).toHaveTextContent(to);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.body).not.toHaveAttribute("data-scroll-locked");
  });

  it("closes when the backdrop is tapped", async () => {
    await renderMobileDrawer("/app");
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const overlay = document.querySelector("[data-state=open].fixed.inset-0") as HTMLElement;
    fireEvent.pointerDown(overlay);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("path")).toHaveTextContent("/app");
  });

  it("closes on Escape", async () => {
    const drawer = await renderMobileDrawer("/app");
    fireEvent.keyDown(drawer, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes on device Back without leaving the page", async () => {
    await renderMobileDrawer("/app/leads");
    act(() => {
      // A real Back: the browser leaves the overlay's history entry.
      window.history.back();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("path")).toHaveTextContent("/app/leads");
  });
});
