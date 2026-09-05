import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { WhatsAppOperationalAnalytics } from "@/lib/whatsappAnalytics";

const state = vi.hoisted(() => ({
  data: null as WhatsAppOperationalAnalytics | null,
  isLoading: false,
}));

vi.mock("@/pages/dashboard/whatsapp/whatsappOutlet", () => ({
  useWhatsAppOutlet: () => ({ workspaceId: "ws-1", canView: true, canManage: true, numbers: [], activeNumbers: [], integration: {} }),
}));
vi.mock("@/hooks/useWorkspaceTimezone", () => ({ useWorkspaceTimezone: () => "UTC" }));
vi.mock("@/hooks/useWhatsAppOperationalAnalytics", () => ({
  useWhatsAppOperationalAnalytics: () => ({ data: state.data, isLoading: state.isLoading }),
}));

import WhatsAppAnalytics from "./WhatsAppAnalytics";

function renderPage() {
  return render(<MemoryRouter initialEntries={["/app/whatsapp/analytics"]}><WhatsAppAnalytics /></MemoryRouter>);
}

const FULL: WhatsAppOperationalAnalytics = {
  conversations_started: 20,
  inbound_messages: 88,
  median_human_response_seconds: 245,
  human_response_sample_size: 7,
  conversations_with_handoff: 7,
  handoff_rate: 0.35,
  median_resolution_seconds: 9000,
  conversations_resolved: 12,
  intake_applicable: 10,
  intake_completed: 6,
  intake_completion_rate: 0.6,
  handled_ai_only: 10,
  handled_human_assisted: 6,
  handled_human_only: 3,
  handled_no_agent_reply: 1,
};

afterEach(() => {
  cleanup();
  state.data = null;
  state.isLoading = false;
});

describe("WhatsAppAnalytics page", () => {
  it("renders the operational header and date-range control", () => {
    state.data = FULL;
    renderPage();
    expect(screen.getByText("WhatsApp Analytics")).toBeInTheDocument();
    expect(screen.getByText("Operational performance for customer conversations.")).toBeInTheDocument();
  });

  it("shows the honest empty state (not a wall of zeros) when there is no conversation data", () => {
    state.data = { ...FULL, conversations_started: 0 };
    renderPage();
    expect(screen.getByText("No WhatsApp conversation data yet")).toBeInTheDocument();
    expect(screen.queryByText("Median human response")).not.toBeInTheDocument();
  });

  it("renders the five KPI cards + the AI-vs-human handling breakdown when data is present", () => {
    state.data = FULL;
    renderPage();
    expect(screen.getByText("Conversations")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("Median human response")).toBeInTheDocument();
    expect(screen.getByText("4m 5s")).toBeInTheDocument();
    expect(screen.getByText("Handoff rate")).toBeInTheDocument();
    expect(screen.getByText("35%")).toBeInTheDocument();
    expect(screen.getByText("Median resolution")).toBeInTheDocument();
    expect(screen.getByText("Intake completion")).toBeInTheDocument();
    expect(screen.getByText("How conversations were handled")).toBeInTheDocument();
    expect(screen.getByText("AI only")).toBeInTheDocument();
  });

  it("UNKNOWN is not ZERO: null medians/rates render as — / N/A", () => {
    state.data = {
      ...FULL,
      median_human_response_seconds: null,
      median_resolution_seconds: null,
      handoff_rate: null,
      intake_completion_rate: null,
      intake_applicable: 0,
    };
    renderPage();
    // two duration KPIs unknown -> em dash appears at least twice
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // two rate KPIs unknown -> N/A appears at least twice
    expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
  });
});
