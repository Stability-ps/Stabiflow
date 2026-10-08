import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OnboardingChecklist } from "./OnboardingChecklist";

const EARLY = {
  members: 1, metaConnected: false, whatsappConnected: false, defaultPipeline: true,
  content: 0, campaigns: 0, conversations: 0, leadsOrOpportunities: 0,
  flowAiConversations: 0, automations: 0, profileComplete: false, analyticsVisited: false,
};
const status = vi.hoisted(() => ({ data: null as Record<string, unknown> | null }));

vi.mock("@/hooks/useOnboardingStatus", () => ({
  useOnboardingStatus: () => ({ data: status.data }),
}));

// The checklist was redesigned for the Home command centre (062ccf0) and made
// compact when nearly complete (ce5f307): it previews the next three steps and
// expands the full authoritative list on request.
describe("OnboardingChecklist", () => {
  afterEach(() => { cleanup(); localStorage.clear(); status.data = null; });

  it("is compact by default and expands authoritative tasks on request", () => {
    status.data = EARLY;
    render(<MemoryRouter><OnboardingChecklist workspaceId="workspace-1" /></MemoryRouter>);
    expect(screen.getByText("2 of 13 complete · 11 remaining")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /view all steps/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Next three remaining steps only.
    expect(screen.getByText("Connect Meta")).toBeInTheDocument();
    expect(screen.queryByText("Connect WhatsApp")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("Connect WhatsApp")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show less/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses to a single line when three or fewer steps remain", () => {
    status.data = {
      ...EARLY, metaConnected: true, whatsappConnected: true, content: 1, campaigns: 1, conversations: 1,
      leadsOrOpportunities: 1, flowAiConversations: 1, profileComplete: true, analyticsVisited: true,
    };
    render(<MemoryRouter><OnboardingChecklist workspaceId="workspace-1" /></MemoryRouter>);
    expect(screen.getByText(/Almost there/)).toBeInTheDocument();
    expect(screen.queryByText("Create your first Automation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view remaining/i }));
    expect(screen.getAllByText("Create your first Automation").length).toBeGreaterThan(0);
  });
});
