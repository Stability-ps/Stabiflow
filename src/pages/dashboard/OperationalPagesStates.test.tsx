// Automations / Documents / Flow AI redesign: a failed read is never shown
// as "not on your plan", "nothing here yet", or a blank editor that could
// create a duplicate record. Flow AI stays usable on a phone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const st = vi.hoisted(() => ({ entErr: false, listErr: false, docsErr: false, hpErr: false }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "ws-1", currentMembership: { role: "owner" }, hasPermission: () => true }) }));
vi.mock("@/components/guide/GuideHelpLink", () => ({ GuideHelpLink: () => null }));
vi.mock("@/lib/billing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing")>("@/lib/billing");
  return { ...actual, fetchEntitlements: async () => { if (st.entErr) throw new Error("boom"); return [{ entitlement_key: "automation_runs", enabled: true }, { entitlement_key: "hosted_profile.publish", enabled: true }]; } };
});
vi.mock("@/hooks/useAutomations", () => ({
  useAutomations: () => ({ data: st.listErr ? undefined : [], isLoading: false, isError: st.listErr, refetch: vi.fn() }),
}));
vi.mock("@/pages/dashboard/automations/AutomationBuilderDialog", () => ({ AutomationBuilderDialog: () => null }));
vi.mock("@/pages/dashboard/automations/AutomationRunsSheet", () => ({ AutomationRunsSheet: () => null }));
vi.mock("@/lib/businessStudio", async () => {
  const actual = await vi.importActual<typeof import("@/lib/businessStudio")>("@/lib/businessStudio");
  return {
    ...actual,
    fetchDocuments: async () => { if (st.docsErr) throw new Error("boom"); return []; },
    fetchHostedProfile: async () => { if (st.hpErr) throw new Error("boom"); return null; },
  };
});
vi.mock("@/lib/businessIdentity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/businessIdentity")>("@/lib/businessIdentity");
  return { ...actual, fetchBusinessIdentity: async () => ({ identity: { trading_name: "Acme" } }) };
});
vi.mock("@/hooks/useFlowAiChat", () => ({
  useFlowAiConversations: () => ({ data: undefined, isError: true, refetch: vi.fn() }),
  useFlowAiMessages: () => ({ data: [], isError: false }),
  useSendFlowAiMessage: () => ({ send: vi.fn(), streamingText: "", isStreaming: false, error: null }),
}));

import Automations from "./Automations";
import Documents from "./Documents";
import FlowAI from "./FlowAI";

function renderPage(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  st.entErr = false; st.listErr = false; st.docsErr = false; st.hpErr = false;
  // jsdom has no element scrolling; Flow AI scrolls its thread on render.
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
});
afterEach(cleanup);

describe("Automations", () => {
  it("a failed plan check never says 'Unlock Automations'", async () => {
    st.entErr = true;
    renderPage(<Automations />);
    expect(await screen.findByText("Couldn't check your plan")).toBeInTheDocument();
    expect(screen.queryByText("Unlock Automations")).not.toBeInTheDocument();
  });

  it("a failed list read is an error, not 'No automations yet'", async () => {
    st.listErr = true;
    renderPage(<Automations />);
    expect(await screen.findByText("Couldn't load automations")).toBeInTheDocument();
    expect(screen.queryByText("No automations yet")).not.toBeInTheDocument();
  });
});

describe("Documents", () => {
  it("a failed documents read is an error, not 'No documents yet'", async () => {
    st.docsErr = true;
    renderPage(<Documents />);
    expect(await screen.findByText(/Couldn't load your documents/)).toBeInTheDocument();
    expect(screen.queryByText("No documents yet")).not.toBeInTheDocument();
  });

  it("a failed hosted-profile read shows an error instead of an empty editor", async () => {
    st.hpErr = true;
    renderPage(<Documents />);
    expect(await screen.findByText(/Couldn't load your hosted profile/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });

  it("a failed plan check doesn't claim hosted profiles aren't on the plan", async () => {
    st.entErr = true;
    renderPage(<Documents />);
    expect(await screen.findByText(/Couldn't check whether your plan includes publishing/)).toBeInTheDocument();
    expect(screen.queryByText(/included with the Business and Growth plans/)).not.toBeInTheDocument();
  });
});

describe("Flow AI", () => {
  it("has a page heading, labelled composer and send button, and a phone conversation picker", () => {
    renderPage(<FlowAI />);
    expect(screen.getByRole("heading", { name: "Flow AI" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message Flow AI" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Conversation" })).toBeInTheDocument();
  });

  it("a failed conversation list says so instead of 'No conversations yet'", () => {
    renderPage(<FlowAI />);
    expect(screen.getByText("Couldn't load conversations.")).toBeInTheDocument();
    expect(screen.queryByText("No conversations yet.")).not.toBeInTheDocument();
  });
});
