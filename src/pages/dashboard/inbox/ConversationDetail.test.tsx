import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InboxConversationRow } from "@/hooks/useInboxConversations";

const state = vi.hoisted(() => ({
  role: "owner",
  wide: true,
  messages: [] as Array<Record<string, unknown>>,
  notes: [] as Array<Record<string, unknown>>,
  templates: [] as Array<Record<string, unknown>>,
}));
const actions = vi.hoisted(() => ({
  replyToConversation: vi.fn(),
  addInternalNote: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "me" }, currentMembership: { role: state.role } }) }));
vi.mock("@/hooks/use-mobile", () => ({ useMediaQuery: () => state.wide, useIsMobile: () => !state.wide }));
vi.mock("@/integrations/supabase/client", () => {
  const q = { select: () => q, eq: () => q, limit: async () => ({ data: [] }) };
  return { supabase: { from: () => q } };
});
vi.mock("@/hooks/useWorkspaceMembers", () => ({ useWorkspaceMembers: () => ({ data: [{ user_id: "me", profile: { full_name: "Thandi Mokoena" } }] }) }));
vi.mock("@/hooks/useInboxMessages", () => ({
  useInboxMessages: () => ({ data: state.messages, isLoading: false }),
  useInboxInternalNotes: () => ({ data: state.notes }),
  getInboxMediaUrl: async () => null,
}));
vi.mock("@/hooks/useLeads", () => ({ useLead: () => ({ data: null }), usePipelines: () => ({ data: [] }), usePipelineStages: () => ({ data: [] }) }));
vi.mock("@/hooks/useOpportunities", () => ({ useOpportunitiesForLead: () => ({ data: [] }), useCustomer: () => ({ data: null }) }));
vi.mock("@/hooks/useCustomers", () => ({ useCustomerMatchCandidates: () => ({ data: [] }), useCustomersSearch: () => ({ data: [] }) }));
vi.mock("@/hooks/useWorkspaceSlaSettings", () => ({ useWorkspaceSlaSettings: () => ({ data: null }) }));
vi.mock("@/hooks/useConversationTimeline", () => ({ useConversationTimeline: () => ({ data: [] }) }));
vi.mock("@/hooks/useInboxTemplates", async (orig) => ({ ...(await orig<typeof import("@/hooks/useInboxTemplates")>()), useInboxTemplates: () => ({ data: state.templates }) }));
vi.mock("@/hooks/useIntakeSchemas", async (orig) => ({ ...(await orig<typeof import("@/hooks/useIntakeSchemas")>()), useIntakeSchemas: () => ({ data: null }) }));
vi.mock("@/hooks/useOpportunityTerminology", () => ({ useOpportunityTerminology: () => "Opportunity" }));
vi.mock("@/components/attribution/AttributionSourceSummary", () => ({ AttributionSourceSummary: () => <p>Direct WhatsApp - no ad referral.</p> }));
vi.mock("@/components/whatsapp/AgentAssistMenu", () => ({ AgentAssistMenu: () => <div>AGENT ASSIST</div> }));
vi.mock("@/lib/inbox", async (orig) => ({ ...(await orig<typeof import("@/lib/inbox")>()), ...actions }));

import { ConversationDetail } from "./ConversationDetail";

const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function conversation(overrides: Partial<InboxConversationRow> = {}): InboxConversationRow {
  return {
    id: "c1", wa_id: "27820000001", phone_number: "+27 82 000 0001", display_name: "Lerato Mokoena", status: "open",
    ai_enabled: false, inbox_status: "assigned", priority_level: "normal", assigned_staff_id: "me", assigned_staff_name: "Thandi Mokoena",
    ai_summary: null, intake_missing_fields: [], intake_payload: null, last_inbound_at: iso(10), last_outbound_at: iso(5), updated_at: iso(5),
    lead_id: null, intake_schema_id: null, intake_completed_at: null, customer_id: null, human_handoff_requested_at: null, last_staff_reply_at: iso(5),
    is_unread: false,
    ...overrides,
  } as InboxConversationRow;
}

function renderDetail(conv: InboxConversationRow, canManage = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConversationDetail workspaceId="w1" conversation={conv} canManage={canManage} onBack={() => {}} onChanged={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.role = "owner";
  state.wide = true;
  state.messages = [
    { id: "m1", direction: "inbound", sender_type: "customer", message_type: "text", content: "Can someone call me about the order?", delivery_status: null, created_at: iso(10) },
    { id: "m2", direction: "outbound", sender_type: "staff", staff_sender_name: "Thandi Mokoena", message_type: "text", content: "Hi Lerato, happy to help.", delivery_status: "failed", created_at: iso(5) },
  ];
  state.notes = [];
  state.templates = [];
  actions.replyToConversation.mockReset().mockResolvedValue({ ok: true });
  actions.addInternalNote.mockReset().mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("ConversationDetail - chat first", () => {
  it("keeps the conversation as the focus: messages, status pills and one action bar", () => {
    renderDetail(conversation());
    expect(screen.getByRole("heading", { level: 3, name: "Lerato Mokoena" })).toBeInTheDocument();
    const log = screen.getByRole("log", { name: "Messages" });
    expect(within(log).getByText("Can someone call me about the order?")).toBeInTheDocument();
    expect(screen.getByText("Messaging window open")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Assign conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resolve/ })).toBeInTheDocument();
  });

  it("makes a failed delivery obvious on the message", () => {
    renderDetail(conversation());
    expect(screen.getByText(/Failed|not delivered/i)).toBeInTheDocument();
  });
});

describe("ConversationDetail - composer", () => {
  it("sends a normal reply while the 24-hour window is open", async () => {
    renderDetail(conversation());
    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), { target: { value: "On my way" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(actions.replyToConversation).toHaveBeenCalledWith("w1", "c1", "On my way"));
  });

  it("explains the closed 24-hour window and offers approved templates instead of a broken composer", () => {
    state.templates = [{ id: "t1", name: "order_update", language: "en_US", category: "UTILITY", provider_status: "APPROVED", components: [{ type: "BODY", text: "Hi {{1}}" }] }];
    renderDetail(conversation({ last_inbound_at: iso(60 * 30) }));
    expect(screen.getByText("The 24-hour reply window has closed")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Reply" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Approved template" })).toBeInTheDocument();
  });

  it("says when no approved templates exist with the window closed", () => {
    renderDetail(conversation({ last_inbound_at: iso(60 * 30) }));
    expect(screen.getByText(/No approved templates are available/)).toBeInTheDocument();
  });

  it("writes internal notes in a distinct mode and shows them inline as not sent to the customer", async () => {
    state.notes = [{ id: "n1", author_name: "Thandi Mokoena", body: "Call back after 3pm", created_at: iso(7) }];
    renderDetail(conversation());
    const note = screen.getByRole("note", { name: "Internal note" });
    expect(note).toHaveTextContent("Call back after 3pm");
    expect(note).toHaveTextContent("not sent to the customer");

    fireEvent.click(screen.getByRole("tab", { name: "Internal note" }));
    expect(screen.queryByRole("textbox", { name: "Reply" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Internal note" }), { target: { value: "VIP customer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(actions.addInternalNote).toHaveBeenCalled());
    expect(actions.replyToConversation).not.toHaveBeenCalled();
  });

  it("view-only members see the chat but no composer or actions", () => {
    renderDetail(conversation(), false);
    expect(screen.getByText(/view-only access/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Assign conversation" })).not.toBeInTheDocument();
  });
});

describe("ConversationDetail - details panel", () => {
  it("on wide screens shows contact, source, customer and lead in a side panel that can be hidden", () => {
    renderDetail(conversation());
    const aside = screen.getByRole("complementary", { name: "Conversation details" });
    for (const section of ["Contact", "Source", "Customer", "Lead"]) expect(within(aside).getByRole("region", { name: section })).toBeInTheDocument();
    expect(within(aside).getByRole("button", { name: /Create lead/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByRole("complementary", { name: "Conversation details" })).not.toBeInTheDocument();
  });

  it("below xl the details open in a drawer instead of stacking above the chat", () => {
    state.wide = false;
    renderDetail(conversation());
    expect(screen.queryByRole("region", { name: "Lead" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByRole("region", { name: "Lead" })).toBeInTheDocument();
  });
});
