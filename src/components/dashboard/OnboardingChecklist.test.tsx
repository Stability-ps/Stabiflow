import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OnboardingChecklist } from "./OnboardingChecklist";

vi.mock("@/hooks/useOnboardingStatus", () => ({
  useOnboardingStatus: () => ({
    data: {
      members: 1, metaConnected: false, whatsappConnected: false, defaultPipeline: true,
      content: 0, campaigns: 0, conversations: 0, leadsOrOpportunities: 0,
      flowAiConversations: 0, automations: 0, profileComplete: false, analyticsVisited: false,
    },
  }),
}));

describe("OnboardingChecklist", () => {
  afterEach(() => { cleanup(); localStorage.clear(); });

  it("is compact by default and expands authoritative tasks on request", () => {
    render(<MemoryRouter><OnboardingChecklist workspaceId="workspace-1" /></MemoryRouter>);
    expect(screen.getByText("Get set up (2/13)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue setup/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Connect Meta")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue setup/i }));
    expect(screen.getByText("Connect Meta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide steps/i })).toHaveAttribute("aria-expanded", "true");
  });
});
