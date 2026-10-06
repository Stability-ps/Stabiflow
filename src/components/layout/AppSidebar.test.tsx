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
    ["Home", "/app"], ["Content", "/app/content"], ["Campaigns", "/app/campaigns"],
    ["Creative Studio", "/app/creative-studio"], ["Messages", "/app/whatsapp/inbox"], ["Leads", "/app/leads"],
    ["Analytics", "/app/analytics"], ["Flow AI", "/app/flow-ai"], ["Automations", "/app/automations"],
    ["Integrations", "/app/integrations"], ["Billing", "/app/billing"], ["Settings", "/app/settings"],
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
    ["/app/whatsapp/inbox", "Messages Inbox"],
    ["/app/whatsapp/contacts", "Messages Contacts"],
    ["/app/whatsapp/templates", "Messages Templates"],
    ["/app/whatsapp/settings", "Messages Settings"],
  ])("keeps the Messages parent selected and marks the child at %s", (path, childName) => {
    renderSidebar(path);
    // The single "Messages" parent stays selected across every child page.
    expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
    // ...and the specific child route is marked current too.
    expect(screen.getByRole("link", { name: childName })).toHaveAttribute("aria-current", "page");
    // No cross-contamination with the top-level items.
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("groups related destinations while keeping Billing and Settings directly visible", () => {
    renderSidebar("/app");
    expect(screen.getByRole("button", { name: "Business" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marketing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Automations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insights" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("exposes the Messages child navigation only while inside the section", () => {
    renderSidebar("/app/leads");
    expect(screen.queryByRole("link", { name: "Messages Contacts" })).not.toBeInTheDocument();
    cleanup();
    renderSidebar("/app/whatsapp/inbox");
    expect(screen.getByRole("link", { name: "Messages Contacts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Messages Templates" })).toBeInTheDocument();
  });

  it("keeps Automations out of the Customers > Messages submenu while retaining Messages Analytics", () => {
    renderSidebar("/app/whatsapp/inbox");
    expect(screen.queryByRole("link", { name: "Messages Automations" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Messages Analytics" })).toHaveAttribute("href", "/app/whatsapp/analytics");
  });
});
