import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

function renderSidebar(path: string) {
  // The sidebar footer reads the workspace plan through React Query.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter></QueryClientProvider>);
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

  it.each(["/app/whatsapp/inbox", "/app/whatsapp/contacts", "/app/whatsapp/templates", "/app/whatsapp/settings"])(
    "keeps the single Messages item selected on every Messages page (%s)",
    (path) => {
      renderSidebar(path);
      expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    },
  );

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
