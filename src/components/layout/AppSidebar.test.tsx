import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

function renderSidebar(path: string) {
  render(<MemoryRouter initialEntries={[path]}><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
}

describe("AppSidebar active state", () => {
  afterEach(cleanup);

  it.each([
    ["Dashboard", "/app"], ["Content", "/app/content"], ["Campaigns", "/app/campaigns"],
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
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
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
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("exposes the WhatsApp child navigation only while inside the section", () => {
    renderSidebar("/app/leads");
    expect(screen.queryByRole("link", { name: "WhatsApp Contacts" })).not.toBeInTheDocument();
    cleanup();
    renderSidebar("/app/whatsapp/inbox");
    expect(screen.getByRole("link", { name: "WhatsApp Contacts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "WhatsApp Templates" })).toBeInTheDocument();
  });

  it("links the WhatsApp sub-nav Automations/Analytics into the shared modules with a WhatsApp filter", () => {
    renderSidebar("/app/whatsapp/inbox");
    expect(screen.getByRole("link", { name: "WhatsApp Automations" })).toHaveAttribute("href", "/app/automations?trigger=conversation");
    expect(screen.getByRole("link", { name: "WhatsApp Analytics" })).toHaveAttribute("href", "/app/analytics?whatsapp");
  });
});
