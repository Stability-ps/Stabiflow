import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Automations from "./Automations";

const mocks = vi.hoisted(() => ({
  automations: [] as Array<Record<string, unknown>>,
  builderProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: "workspace-1", currentMembership: { role: "owner" } }),
}));
vi.mock("@/hooks/useAutomations", () => ({
  useAutomations: () => ({ data: mocks.automations, isLoading: false, refetch: vi.fn() }),
}));
vi.mock("@/pages/dashboard/automations/AutomationBuilderDialog", () => ({
  AutomationBuilderDialog: (props: Record<string, unknown>) => {
    mocks.builderProps.push(props);
    return props.open ? <div data-testid="builder-open">{(props.template as { name: string } | null)?.name ?? "blank"}</div> : null;
  },
}));
vi.mock("@/pages/dashboard/automations/AutomationRunsSheet", () => ({ AutomationRunsSheet: () => null }));

function renderPage() {
  return render(<MemoryRouter><Automations /></MemoryRouter>);
}

describe("Automations landing page", () => {
  afterEach(() => { cleanup(); mocks.builderProps = []; });

  it("shows outcome-based templates before the technical builder", () => {
    mocks.automations = [];
    renderPage();
    expect(screen.getByText("Follow up with new leads")).toBeInTheDocument();
    expect(screen.getByText("Welcome new customers")).toBeInTheDocument();
    expect(screen.getByText("Notify my team")).toBeInTheDocument();
    // The friendly subtitle leads; the technical WHEN/IF/THEN framing is
    // secondary, smaller copy near "Your automations", not the header.
    expect(screen.getByText("Let StabiFlow handle repetitive work for you.")).toBeInTheDocument();
  });

  it("never advertises an invoice-related automation template", () => {
    mocks.automations = [];
    renderPage();
    expect(screen.queryByText(/invoice/i)).not.toBeInTheDocument();
  });

  it("clicking Set up on a template opens the advanced builder pre-filled with that template", () => {
    mocks.automations = [];
    renderPage();
    const card = screen.getByText("Welcome new customers").closest("div.shadow-card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Set up" }));
    expect(screen.getByTestId("builder-open")).toHaveTextContent("Welcome new customers");
  });

  it("Create automation opens the advanced builder with no template", () => {
    mocks.automations = [];
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /Create automation/ })[0]);
    expect(screen.getByTestId("builder-open")).toHaveTextContent("blank");
  });

  it("still lists existing automations in the table below the templates", () => {
    mocks.automations = [{ id: "a1", name: "Existing flow", status: "enabled", trigger_event_type: "lead.created" }];
    renderPage();
    expect(screen.getByText("Existing flow")).toBeInTheDocument();
    expect(screen.getByText("Your automations")).toBeInTheDocument();
  });
});
