import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { NeedsAttentionItem } from "@/lib/needsAttention";

const state = vi.hoisted(() => ({
  data: [] as NeedsAttentionItem[],
  isLoading: false,
  isError: false,
  lastWorkspaceArg: undefined as string | null | undefined,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentMembership: { role: "owner" } }),
}));
vi.mock("@/hooks/useNeedsAttention", () => ({
  useNeedsAttention: (workspaceId: string | null) => {
    state.lastWorkspaceArg = workspaceId;
    return { data: state.data, isLoading: state.isLoading, isError: state.isError };
  },
}));

import { NeedsAttentionPanel } from "./NeedsAttentionPanel";

function item(overrides: Partial<NeedsAttentionItem> = {}): NeedsAttentionItem {
  return {
    id: "customer_reply:conv-1",
    type: "customer_reply",
    severity: "warning",
    title: "Customer replied",
    description: "Nomsa sent a new message.",
    occurredAt: new Date().toISOString(),
    targetType: "conversation",
    targetId: "conv-1",
    actionPath: "/app/whatsapp/inbox",
    actionLabel: "Open conversation",
    ...overrides,
  };
}

function renderPanel(workspaceId: string | null = "ws-1") {
  return render(
    <MemoryRouter>
      <NeedsAttentionPanel workspaceId={workspaceId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.data = [];
  state.isLoading = false;
  state.isError = false;
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

  it("shows a friendly (non-technical) message on error", () => {
    state.isError = true;
    renderPanel();
    expect(screen.getByText(/refresh automatically/i)).toBeInTheDocument();
  });

  it("renders each item with its severity and a deep link carrying navigation state", () => {
    state.data = [
      item(),
      item({ id: "campaign_failed:c1", type: "campaign_failed", severity: "critical", title: "Campaign publish failed", targetType: "campaign", targetId: "c1", actionPath: "/app/campaigns/c1", actionLabel: "Open campaign" }),
    ];
    renderPanel();
    expect(screen.getByText("Customer replied")).toBeInTheDocument();
    expect(screen.getByText("Campaign publish failed")).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();

    const convLink = screen.getByRole("link", { name: /Open conversation: Customer replied/i });
    expect(convLink).toHaveAttribute("href", "/app/whatsapp/inbox");
    const campLink = screen.getByRole("link", { name: /Open campaign: Campaign publish failed/i });
    expect(campLink).toHaveAttribute("href", "/app/campaigns/c1");
  });

  it("truncates to the limit and reports how many more exist", () => {
    state.data = Array.from({ length: 9 }, (_, i) => item({ id: `x:${i}`, targetId: `c${i}` }));
    renderPanel();
    expect(screen.getByText("+3 more")).toBeInTheDocument();
  });
});
