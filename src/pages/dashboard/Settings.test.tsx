import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Settings from "./Settings";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mocks.navigate };
});
vi.mock("@/pages/dashboard/settings/WorkspaceTab", () => ({ WorkspaceTab: () => <div>WORKSPACE TAB</div> }));
vi.mock("@/pages/dashboard/settings/MembersTab", () => ({ MembersTab: () => <div>MEMBERS TAB</div> }));
vi.mock("@/pages/dashboard/settings/AccountTab", () => ({ AccountTab: () => <div>ACCOUNT TAB</div> }));

function renderSettings() {
  return render(<MemoryRouter><Settings /></MemoryRouter>);
}

describe("Settings index", () => {
  afterEach(() => { cleanup(); mocks.navigate.mockClear(); });

  it("groups settings into Your Business, Connections, StabiFlow, and Account", () => {
    renderSettings();
    expect(screen.getByText("Your Business")).toBeInTheDocument();
    expect(screen.getByText("Connections")).toBeInTheDocument();
    expect(screen.getByText("StabiFlow")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
  });

  it("no longer shows Billing or Integrations as their own top-level tabs - they're rows here", () => {
    renderSettings();
    expect(screen.queryByRole("tab", { name: "Billing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Integrations" })).not.toBeInTheDocument();
  });

  it("Connections rows navigate to the existing Integrations page", () => {
    renderSettings();
    fireEvent.click(screen.getByText("All integrations"));
    expect(mocks.navigate).toHaveBeenCalledWith("/app/integrations");
  });

  it("Billing & plan navigates to the existing Billing page", () => {
    renderSettings();
    fireEvent.click(screen.getByText("Billing & plan"));
    expect(mocks.navigate).toHaveBeenCalledWith("/app/billing");
  });

  it("Dashboard preferences navigates Home and asks it to open the customizer", () => {
    renderSettings();
    fireEvent.click(screen.getByText("Dashboard preferences"));
    expect(mocks.navigate).toHaveBeenCalledWith("/app", { state: { openDashboardCustomizer: true } });
  });

  it("marks not-yet-built StabiFlow settings as Coming soon rather than showing fake UI", () => {
    renderSettings();
    const notifications = screen.getByText("Notifications").closest("button") as HTMLButtonElement;
    expect(notifications).toBeDisabled();
    expect(screen.getAllByText("Coming soon").length).toBeGreaterThan(0);
  });

  it("still renders the existing Workspace/Members/Account tab content, unchanged", () => {
    renderSettings();
    expect(screen.getByText("WORKSPACE TAB")).toBeInTheDocument();
    expect(screen.getByText("ACCOUNT TAB")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Team & permissions/ }), { button: 0 });
    expect(screen.getByText("MEMBERS TAB")).toBeInTheDocument();
  });
});
