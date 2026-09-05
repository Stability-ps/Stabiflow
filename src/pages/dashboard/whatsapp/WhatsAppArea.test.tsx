import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import WhatsAppLayout from "./WhatsAppLayout";
import WhatsAppInbox from "./Inbox";
import WhatsAppContacts from "./Contacts";
import WhatsAppTemplates from "./Templates";
import WhatsAppSettings from "./Settings";

const state = vi.hoisted(() => ({
  workspaceId: "workspace-1" as string | null,
  role: "owner" as string,
  integrations: [] as Array<Record<string, unknown>>,
  numbers: [] as Array<Record<string, unknown>>,
  lastEvent: null as Record<string, unknown> | null,
  recentEvents: [] as Array<Record<string, unknown>>,
  conversations: [] as Array<Record<string, unknown>>,
  templates: [] as Array<Record<string, unknown>>,
}));

const inboxActionSpies = vi.hoisted(() => ({
  markConversationRead: vi.fn(),
  runInboxAction: vi.fn(),
  assignConversation: vi.fn(),
  replyToConversation: vi.fn(),
}));
const leadSpies = vi.hoisted(() => ({
  createLeadFromConversation: vi.fn(),
  linkLeadConversation: vi.fn(),
  checkDuplicateLeads: vi.fn(),
}));
const integrationSpies = vi.hoisted(() => ({
  setResourceActive: vi.fn(),
  disconnectIntegration: vi.fn(),
  refreshIntegrationResources: vi.fn(),
  checkIntegrationConnectionHealth: vi.fn(),
  repairWhatsAppWebhookSubscription: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: state.workspaceId, currentMembership: state.workspaceId ? { role: state.role } : null }),
}));
vi.mock("@/hooks/useIntegrations", () => ({
  useWorkspaceIntegrations: () => ({ data: state.integrations, isLoading: false }),
  useAllWhatsAppNumbers: (workspaceId: string | null) => {
    integrationSpies.checkIntegrationConnectionHealth; // referenced to keep import side effects consistent
    return { data: workspaceId ? state.numbers : [], isLoading: false, workspaceIdArg: workspaceId };
  },
}));
vi.mock("@/hooks/useWhatsAppStatus", () => ({
  useLastWhatsAppWebhookEvent: () => ({ data: state.lastEvent }),
  useRecentWhatsAppWebhookEvents: () => ({ data: state.recentEvents ?? [] }),
}));
vi.mock("@/hooks/useInboxConversations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useInboxConversations")>();
  return {
    ...actual,
    useInboxConversations: vi.fn((workspaceId: string | null) => ({ data: workspaceId ? state.conversations : [], isLoading: false })),
    useInboxConversationsInfinite: vi.fn((workspaceId: string | null) => ({
      conversations: workspaceId ? state.conversations : [],
      isLoading: false,
      isFetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    })),
    useInboxConversationReads: () => ({ data: new Map() }),
    isConversationUnread: () => false,
  };
});
vi.mock("@/hooks/useWorkspaceMembers", () => ({ useWorkspaceMembers: () => ({ data: [] }) }));
vi.mock("@/hooks/useInboxTemplates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useInboxTemplates")>();
  return { ...actual, useInboxTemplates: () => ({ data: state.templates, isLoading: false }) };
});
vi.mock("@/lib/inbox", () => inboxActionSpies);
vi.mock("@/lib/leads", () => ({ ...leadSpies, __esModule: true }));
vi.mock("@/lib/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations")>();
  return { ...actual, ...integrationSpies };
});
// The conversation detail pane is exercised by its own suite - stub it here
// so this test focuses on routing / gating / composition without dragging
// in its full hook graph.
vi.mock("@/pages/dashboard/inbox/ConversationDetail", () => ({
  ConversationDetail: ({ conversation }: { conversation: { display_name: string | null; phone_number: string } }) => (
    <div>DETAIL: {conversation.display_name || conversation.phone_number}</div>
  ),
}));

import { useInboxConversations, useInboxConversationsInfinite } from "@/hooks/useInboxConversations";

function renderArea(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/inbox" element={<Navigate to="/app/whatsapp/inbox" replace />} />
          <Route path="/app/whatsapp" element={<WhatsAppLayout />}>
            <Route index element={<Navigate to="/app/whatsapp/inbox" replace />} />
            <Route path="inbox" element={<WhatsAppInbox />} />
            <Route path="contacts" element={<WhatsAppContacts />} />
            <Route path="templates" element={<WhatsAppTemplates />} />
            <Route path="settings" element={<WhatsAppSettings />} />
          </Route>
          <Route path="/app/integrations" element={<div>INTEGRATIONS PAGE</div>} />
        </Routes>
      </MemoryRouter>,
    </QueryClientProvider>,
  );
}

const CONNECTED_INTEGRATION = {
  id: "int-1",
  provider: "whatsapp",
  status: "connected",
  last_health_check_status: "healthy",
  last_health_check_at: "2026-08-30T09:00:00Z",
  connected_at: "2026-08-01T00:00:00Z",
  webhook_subscription_status: null as string | null,
  webhook_subscription_checked_at: null as string | null,
  webhook_subscription_detail: null as string | null,
};
const ACTIVE_NUMBER = {
  id: "num-1", phone_number_id: "pnid-1", display_phone_number: "+27 11 000 0000",
  verified_name: "StabiFlow Test", quality_rating: "GREEN", platform_status: null, waba_id: "waba-1", is_active: true,
};

beforeEach(() => {
  state.workspaceId = "workspace-1";
  state.role = "owner";
  state.integrations = [CONNECTED_INTEGRATION];
  state.numbers = [ACTIVE_NUMBER];
  state.lastEvent = { event_type: "message", received_at: "2026-08-30T09:30:00Z" };
  state.recentEvents = [];
  state.conversations = [];
  state.templates = [];
  Object.values(inboxActionSpies).forEach((s) => s.mockReset());
  Object.values(leadSpies).forEach((s) => s.mockReset());
  Object.values(integrationSpies).forEach((s) => s.mockReset());
  (useInboxConversations as unknown as ReturnType<typeof vi.fn>).mockClear();
  (useInboxConversationsInfinite as unknown as ReturnType<typeof vi.fn>).mockClear();
});
afterEach(cleanup);

describe("legacy /app/inbox compatibility", () => {
  it("redirects /app/inbox to /app/whatsapp/inbox", () => {
    renderArea("/app/inbox");
    // The WhatsApp product header renders once the redirect lands.
    expect(screen.getByRole("heading", { name: "WhatsApp", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "WhatsApp sections" })).toBeInTheDocument();
  });

  it("redirects the section index /app/whatsapp to the Inbox child", () => {
    renderArea("/app/whatsapp");
    expect(screen.getByRole("navigation", { name: "WhatsApp sections" })).toBeInTheDocument();
  });
});

describe("gating", () => {
  it("shows a permission empty state when the member cannot view the inbox", () => {
    state.role = "viewer";
    renderArea("/app/whatsapp/inbox");
    expect(screen.getByText(/don't have permission to view this workspace's WhatsApp/i)).toBeInTheDocument();
  });

  it("shows a Connect WhatsApp empty state (not a blank screen) when no integration is connected", () => {
    state.integrations = [];
    renderArea("/app/whatsapp/inbox");
    expect(screen.getByText("Connect WhatsApp Business to use Inbox, templates, contacts and automations.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeInTheDocument();
  });
});

describe("connected state - production wiring indicators", () => {
  it("shows the active phone number, integration health, and last inbound event - all from real state", () => {
    renderArea("/app/whatsapp/inbox");
    const statusRegion = screen.getByRole("region", { name: "WhatsApp connection status" });
    expect(statusRegion).toHaveTextContent("StabiFlow Test");
    expect(statusRegion).toHaveTextContent("+27 11 000 0000");
    expect(statusRegion).toHaveTextContent(/Healthy/i);
    expect(statusRegion).toHaveTextContent("Last inbound event");
    expect(statusRegion).toHaveTextContent("message");
  });

  it("reports the webhook subscription from real state: 'Receiving events' when inbound events are arriving, no warning", () => {
    // default fixture: lastEvent is a real 'message' event
    renderArea("/app/whatsapp/inbox");
    const statusRegion = screen.getByRole("region", { name: "WhatsApp connection status" });
    expect(statusRegion).toHaveTextContent("Webhook subscription");
    expect(statusRegion).toHaveTextContent("Receiving events");
    expect(screen.queryByText(/webhook subscription is not confirmed/i)).not.toBeInTheDocument();
  });

  it("when the subscription is not confirmed and no events have been seen, shows 'Unknown' plus a warning strip with a Fix action (owner has integration.manage)", () => {
    state.lastEvent = null;
    state.integrations = [{ ...CONNECTED_INTEGRATION, webhook_subscription_status: null }];
    renderArea("/app/whatsapp/inbox");
    expect(screen.getByRole("region", { name: "WhatsApp connection status" })).toHaveTextContent("Unknown");
    expect(screen.getByText(/webhook subscription is not confirmed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fix in Settings" })).toBeInTheDocument();
  });

  it("when the subscription is explicitly 'not_subscribed', the shell shows an actionable warning", () => {
    state.integrations = [{ ...CONNECTED_INTEGRATION, webhook_subscription_status: "not_subscribed" }];
    renderArea("/app/whatsapp/inbox");
    const statusRegion = screen.getByRole("region", { name: "WhatsApp connection status" });
    expect(statusRegion).toHaveTextContent("Not subscribed");
    expect(screen.getByText(/webhook subscription is not confirmed/i)).toBeInTheDocument();
  });

  it("'subscribed' reads as healthy with no warning strip", () => {
    state.integrations = [{ ...CONNECTED_INTEGRATION, webhook_subscription_status: "subscribed" }];
    renderArea("/app/whatsapp/inbox");
    expect(screen.getByRole("region", { name: "WhatsApp connection status" })).toHaveTextContent("Subscribed");
    expect(screen.queryByText(/webhook subscription is not confirmed/i)).not.toBeInTheDocument();
  });

  it("a manager (inbox.view but NOT integration.manage) sees the warning state but no repair action in the shell", () => {
    state.role = "manager";
    state.lastEvent = null;
    state.integrations = [{ ...CONNECTED_INTEGRATION, webhook_subscription_status: "not_subscribed" }];
    renderArea("/app/whatsapp/inbox");
    expect(screen.getByText(/webhook subscription is not confirmed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fix in Settings" })).not.toBeInTheDocument();
  });

  it("warns when there is no active number", () => {
    state.numbers = [{ ...ACTIVE_NUMBER, is_active: false }];
    renderArea("/app/whatsapp/inbox");
    expect(screen.getByRole("region", { name: "WhatsApp connection status" })).toHaveTextContent("No active number");
  });
});

describe("WhatsApp Inbox child", () => {
  it("shows the no-conversation state when connected but empty", () => {
    state.conversations = [];
    renderArea("/app/whatsapp/inbox");
    expect(screen.getByText(/Waiting for your first conversation/i)).toBeInTheDocument();
  });

  it("renders existing conversations and does not fire any mutation on render", () => {
    state.conversations = [
      { id: "c1", wa_id: "27820000001", phone_number: "+27 82 000 0001", display_name: "Nomsa", inbox_status: "unassigned", priority_level: "normal", last_inbound_at: "2026-08-30T09:00:00Z", updated_at: "2026-08-30T09:00:00Z", lead_id: null },
    ];
    renderArea("/app/whatsapp/inbox");
    expect(screen.getByText("Nomsa")).toBeInTheDocument();
    // Read-only render: no staff action, no read receipt, no lead write.
    expect(inboxActionSpies.markConversationRead).not.toHaveBeenCalled();
    expect(inboxActionSpies.runInboxAction).not.toHaveBeenCalled();
    expect(leadSpies.createLeadFromConversation).not.toHaveBeenCalled();
  });

  it("scopes the conversation query to the active workspace id (isolation)", () => {
    renderArea("/app/whatsapp/inbox");
    expect(useInboxConversationsInfinite).toHaveBeenCalledWith("workspace-1", expect.anything());
  });
});

describe("WhatsApp Contacts child", () => {
  it("derives a de-duplicated contact list from conversations, read-only", () => {
    state.conversations = [
      { id: "c1", wa_id: "27820000001", phone_number: "+27 82 000 0001", display_name: "Nomsa", inbox_status: "assigned", priority_level: "normal", last_inbound_at: "2026-08-30T09:00:00Z", updated_at: "2026-08-30T09:00:00Z", lead_id: "lead-1" },
      { id: "c2", wa_id: "27820000001", phone_number: "+27 82 000 0001", display_name: "Nomsa", inbox_status: "resolved", priority_level: "normal", last_inbound_at: "2026-08-29T09:00:00Z", updated_at: "2026-08-29T09:00:00Z", lead_id: null },
      { id: "c3", wa_id: "27820000002", phone_number: "+27 82 000 0002", display_name: null, inbox_status: "new", priority_level: "normal", last_inbound_at: "2026-08-28T09:00:00Z", updated_at: "2026-08-28T09:00:00Z", lead_id: null },
    ];
    renderArea("/app/whatsapp/contacts");
    // 2 unique contacts, not 3 conversations.
    const openButtons = screen.getAllByRole("button", { name: /Open conversation with/ });
    expect(openButtons).toHaveLength(2);
    expect(screen.getByText(/2 conversations/)).toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(inboxActionSpies.runInboxAction).not.toHaveBeenCalled();
    expect(leadSpies.linkLeadConversation).not.toHaveBeenCalled();
  });

  it("shows an explanatory empty state when there are no contacts", () => {
    state.conversations = [];
    renderArea("/app/whatsapp/contacts");
    expect(screen.getByText("Contacts appear here automatically as customers message your WhatsApp number.")).toBeInTheDocument();
  });
});

describe("WhatsApp Templates child", () => {
  it("lists synced templates read-only with their provider status", () => {
    state.templates = [
      { id: "t1", name: "order_update", language: "en_US", category: "UTILITY", provider_status: "APPROVED", components: [{ type: "BODY", text: "Hi {{1}}, your order shipped." }] },
    ];
    renderArea("/app/whatsapp/templates");
    expect(screen.getByText("order_update")).toBeInTheDocument();
    expect(screen.getByText("APPROVED")).toBeInTheDocument();
    expect(screen.getByText(/your order shipped/i)).toBeInTheDocument();
  });

  it("shows a sync explanation when no templates exist", () => {
    state.templates = [];
    renderArea("/app/whatsapp/templates");
    expect(screen.getByText(/Message templates are created in Meta and synced into StabiFlow/i)).toBeInTheDocument();
  });
});

describe("WhatsApp Settings child", () => {
  it("Phase 15: renders the recent-webhook-activity panel with business-friendly outcome text, no raw JSON", () => {
    state.recentEvents = [
      { id: "e1", received_at: "2026-08-30T09:29:00Z", event_type: "message", phone_number_id: "pnid-1", resolved: true, outcome: "stored", message_type: "text", is_unresolved: false },
      { id: "e2", received_at: "2026-08-30T09:20:00Z", event_type: "message", phone_number_id: "pnid-x", resolved: false, outcome: "unresolved_number", message_type: null, is_unresolved: true },
    ];
    renderArea("/app/whatsapp/settings");
    expect(screen.getByText("Recent webhook activity")).toBeInTheDocument();
    expect(screen.getByText("Received and routed")).toBeInTheDocument();
    expect(screen.getByText(/Unresolved phone number/i)).toBeInTheDocument();
    expect(screen.queryByText(/payload_summary|\{"/)).not.toBeInTheDocument();
  });

  it("Phase 15: recent-webhook-activity shows an empty state when there are none", () => {
    state.recentEvents = [];
    renderArea("/app/whatsapp/settings");
    expect(screen.getByText("No webhook activity received yet.")).toBeInTheDocument();
  });

  it("reuses the integration connection state (WABA, numbers, health) without duplicating the integration logic", () => {
    renderArea("/app/whatsapp/settings");
    expect(screen.getByText("waba-1")).toBeInTheDocument();
    expect(screen.getByText("1 active / 1 total")).toBeInTheDocument();
    expect(screen.getByText(/Manage WhatsApp/)).toBeInTheDocument(); // the shared WhatsAppManagePanel, page chrome
    // Rendering Settings performs no integration mutation.
    expect(integrationSpies.setResourceActive).not.toHaveBeenCalled();
    expect(integrationSpies.disconnectIntegration).not.toHaveBeenCalled();
    expect(integrationSpies.refreshIntegrationResources).not.toHaveBeenCalled();
  });

  it("shows the real webhook subscription state and a 'Subscribe webhook' action for a manager of the integration (owner has integration.manage), plus a Meta-check hint when unconfirmed", () => {
    state.lastEvent = null;
    state.integrations = [{ ...CONNECTED_INTEGRATION, webhook_subscription_status: null }];
    renderArea("/app/whatsapp/settings");
    expect(screen.getAllByText("Webhook subscription").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Unknown/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Subscribe webhook/i })).toBeInTheDocument();
    expect(screen.getByText(/verify in Meta that the WhatsApp Business Account/i)).toBeInTheDocument();
  });

  it("'not_subscribed' offers 'Subscribe webhook'; clicking it calls repairWhatsAppWebhookSubscription and nothing else", async () => {
    integrationSpies.repairWhatsAppWebhookSubscription.mockResolvedValue({ ok: true, webhookSubscription: { status: "subscribed", detail: "ok", wabaCount: 1 } });
    state.integrations = [{ ...CONNECTED_INTEGRATION, webhook_subscription_status: "not_subscribed" }];
    renderArea("/app/whatsapp/settings");
    const btn = screen.getByRole("button", { name: /Subscribe webhook/i });
    btn.click();
    expect(integrationSpies.repairWhatsAppWebhookSubscription).toHaveBeenCalledWith("workspace-1");
    expect(integrationSpies.setResourceActive).not.toHaveBeenCalled();
    expect(integrationSpies.disconnectIntegration).not.toHaveBeenCalled();
  });

  it("Phase 15: after Repair, per-WABA results render individually - successes stay visible when one fails", async () => {
    integrationSpies.repairWhatsAppWebhookSubscription.mockResolvedValue({
      ok: true,
      webhookSubscription: {
        status: "error",
        detail: "one failed",
        wabaCount: 3,
        perWaba: [
          { wabaId: "111122223333", subscribed: true, verified: true, status: "subscribed", error: null },
          { wabaId: "444455556666", subscribed: true, verified: true, status: "subscribed", error: null },
          { wabaId: "777788889999", subscribed: false, verified: null, status: "error", error: "Meta rate limit - try again shortly." },
        ],
      },
    });
    state.integrations = [{ ...CONNECTED_INTEGRATION, webhook_subscription_status: "not_subscribed" }];
    renderArea("/app/whatsapp/settings");
    screen.getByRole("button", { name: /Subscribe webhook/i }).click();
    // per-WABA rows: 2 "Subscribed" + 1 "Needs repair"/"Check failed", plus the curated reason
    expect(await screen.findAllByText("Subscribed")).toHaveLength(2);
    expect(screen.getByText("Check failed")).toBeInTheDocument();
    expect(screen.getByText("Meta rate limit - try again shortly.")).toBeInTheDocument();
    // shortened WABA identifier, not a raw full id dump
    expect(screen.getByText("WABA …9999")).toBeInTheDocument();
  });

  it("a manager (no integration.manage) sees the subscription state but NO repair button in Settings", () => {
    state.role = "manager";
    state.integrations = [{ ...CONNECTED_INTEGRATION, webhook_subscription_status: "not_subscribed" }];
    renderArea("/app/whatsapp/settings");
    expect(screen.getAllByText("Webhook subscription").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Subscribe webhook/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Repair subscription/i })).not.toBeInTheDocument();
  });

  it("'subscribed' reads healthy and offers 'Repair subscription' (idempotent re-check) for a manager of the integration", () => {
    state.integrations = [{ ...CONNECTED_INTEGRATION, webhook_subscription_status: "subscribed" }];
    renderArea("/app/whatsapp/settings");
    expect(screen.getAllByText(/Subscribed/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Repair subscription/i })).toBeInTheDocument();
    expect(screen.queryByText(/verify in Meta that the WhatsApp Business Account/i)).not.toBeInTheDocument();
  });
});
