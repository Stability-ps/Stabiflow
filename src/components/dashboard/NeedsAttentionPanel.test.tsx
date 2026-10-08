import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { NeedsAttentionItem } from "@/lib/needsAttention";

const state = vi.hoisted(() => ({
  items: [] as NeedsAttentionItem[],
  isLoading: false,
  partialFailure: false,
  lastWorkspaceArg: undefined as string | null | undefined,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentMembership: { role: "owner" } }) }));
vi.mock("@/hooks/useNeedsAttention", () => ({
  useNeedsAttention: (workspaceId: string | null) => {
    state.lastWorkspaceArg = workspaceId;
    return { items: state.items, isLoading: state.isLoading, partialFailure: state.partialFailure };
  },
}));

import { NeedsAttentionPanel } from "./NeedsAttentionPanel";

function item(overrides: Partial<NeedsAttentionItem> = {}): NeedsAttentionItem {
  return {
    id: "alert:conv-1",
    kind: "customer_reply",
    severity: "warning",
    title: "Customer replied",
    description: "Nomsa sent a new message.",
    occurredAt: new Date().toISOString(),
    targetType: "conversation",
    targetId: "conv-1",
    actionPath: "/app/whatsapp/inbox",
    actionLabel: "Open conversation",
    canAct: true,
    ...overrides,
  };
}

function renderPanel(workspaceId: string | null = "ws-1") {
  return render(<MemoryRouter><NeedsAttentionPanel workspaceId={workspaceId} /></MemoryRouter>);
}

beforeEach(() => {
  state.items = [];
  state.isLoading = false;
  state.partialFailure = false;
  state.lastWorkspaceArg = undefined;
});
afterEach(cleanup);

describe("NeedsAttentionPanel", () => {
  it("scopes its data query to the active workspace id", () => {
    renderPanel("ws-42");
    expect(state.lastWorkspaceArg).toBe("ws-42");
  });

  it("shows an all-clear state when nothing needs attention", () => {
    renderPanel();
    expect(screen.getByText(/Nothing needs your attention right now/i)).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    state.isLoading = true;
    const { container } = renderPanel();
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("notes when some sources could not be checked (partial failure — audit M10)", () => {
    state.partialFailure = true;
    state.items = [item()];
    renderPanel();
    expect(screen.getByText(/Some sources couldn.t be checked/i)).toBeInTheDocument();
  });

  it("renders each item with its severity and a deep link carrying navigation state", () => {
    state.items = [
      item(),
      item({ id: "campaign:c1", kind: "campaign_failed", severity: "critical", title: "Campaign publish failed", targetType: "campaign", targetId: "c1", actionPath: "/app/campaigns/c1", actionLabel: "Open campaign" }),
    ];
    renderPanel();
    expect(screen.getByText("Customer replied")).toBeInTheDocument();
    expect(screen.getByText("Campaign publish failed")).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open conversation: Customer replied/i })).toHaveAttribute("href", "/app/whatsapp/inbox");
    expect(screen.getByRole("link", { name: /Open campaign: Campaign publish failed/i })).toHaveAttribute("href", "/app/campaigns/c1");
  });

  it("shows a plain 'View' link (not the action verb) when the viewer may not perform the action (audit M12)", () => {
    state.items = [
      item({ id: "lead:l1", kind: "lead_unowned", severity: "warning", title: "Lead is waiting to be picked up", targetType: "lead", targetId: "l1", actionPath: "/app/leads", actionLabel: "View lead", canAct: false }),
    ];
    renderPanel();
    expect(screen.getByRole("link", { name: /^View: Lead is waiting to be picked up$/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Assign lead/i })).not.toBeInTheDocument();
  });

  it("does not render a timestamp line when occurredAt is null (audit M14)", () => {
    state.items = [item({ id: "integration:i1", kind: "integration_unhealthy", occurredAt: null, description: "Health check failed." })];
    const { container } = renderPanel();
    expect(container.textContent).not.toMatch(/\bjust now\b|\d+[mhd] ago/);
  });

  it("truncates to the limit and reports how many more exist", () => {
    state.items = Array.from({ length: 9 }, (_, i) => item({ id: `alert:${i}`, targetId: `c${i}` }));
    renderPanel();
    expect(screen.getByText("+3 more")).toBeInTheDocument();
  });
});
