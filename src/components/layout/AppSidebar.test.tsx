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
    ["Creative Studio", "/app/creative-studio"], ["Inbox", "/app/inbox"], ["Leads", "/app/leads"],
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
});
