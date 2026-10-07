import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Customer360 } from "@/lib/customer";

const state = vi.hoisted(() => ({
  role: "owner" as string | undefined,
  data: null as Customer360 | null,
  loading: false,
  error: null as Error | null,
  refetch: vi.fn(),
  requested: [] as Array<string | null>,
}));
const sign = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "w1", currentMembership: state.role ? { role: state.role } : null }) }));
vi.mock("@/hooks/useCustomers", () => ({
  useCustomer360: (ws: string | null) => { state.requested.push(ws); return { data: state.data ?? undefined, isLoading: state.loading, error: state.error, refetch: state.refetch }; },
}));
vi.mock("@/lib/leads", async (orig) => ({ ...(await orig<typeof import("@/lib/leads")>()), signLeadAttachment: sign }));

import Customer360Page from "./Customer360";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();

function rich(): Customer360 {
  return {
    identity: { id: "c1", name: "Lerato Mokoena", phone: "+27 82 111 0000", phone_normalized: "27821110000", email: "lerato@example.com", company_name: "Celebration Cakes", status: "active", customer_since: iso(54), assigned_to: "u1", assigned_to_name: "Thandi Mokoena", created_at: iso(54) },
    counts: { conversations: 2, leads: 1, opportunities: 2, open_opportunities: 1 },
    conversations: [
      { id: "cv1", wa_id: "1", phone_number: "+27 82 111 0000", display_name: "Lerato", status: "human_handoff", ai_enabled: false, inbox_status: "unassigned", assigned_staff_name: null, last_inbound_at: iso(0), last_outbound_at: null, updated_at: iso(0), customer_id: "c1" },
      { id: "cv2", wa_id: "2", phone_number: "+27 82 111 0001", display_name: "Lerato (work)", status: "bot_active", ai_enabled: true, inbox_status: "resolved", assigned_staff_name: null, last_inbound_at: iso(30), last_outbound_at: null, updated_at: iso(30), customer_id: "c1" },
    ],
    leads: [{ id: "l1", human_reference: "L-0042", contact_name: "Lerato Mokoena", status: "converted", qualification_status: "qualified", source: "facebook_lead_ad", source_detail: null, estimated_value: 18000, created_at: iso(60), stage_name: "Won", pipeline_name: "Sales", attribution: null }],
    opportunities: [
      { id: "o1", title: "Wedding cake", status: "open", estimated_value: 18000, actual_value: null, won_at: null, lost_at: null, created_at: iso(4), stage_name: "Proposal sent", pipeline_name: "Sales", owner_name: "Thandi Mokoena" },
      { id: "o2", title: "Birthday cake", status: "won", estimated_value: 3500, actual_value: 3500, won_at: iso(54), lost_at: null, created_at: iso(58), stage_name: "Won", pipeline_name: "Sales", owner_name: null },
    ],
    revenue_by_currency: [{ currency: "ZAR", total_minor: 350000, event_count: 1 }, { currency: "USD", total_minor: 10000, event_count: 1 }],
    documents: [{ id: "d1", media_filename: "Quote.pdf", media_mime_type: "application/pdf", media_size_bytes: 2048, source: "whatsapp", received_at: iso(3), lead_id: "l1", created_at: iso(3) }],
    notes: [{ id: "n1", target_type: "opportunity", target_id: "o1", author_name: "Thandi Mokoena", body: "Three tiers, gold leaf.", created_at: iso(2) }],
    activity: [{ id: "a1", action: "opportunity_stage_changed", target_type: "opportunity", target_id: "o1", actor_role: "owner", actor_name: "Thandi Mokoena", metadata: {}, created_at: iso(1) }],
    attribution: { campaign_id: "camp1", method: "exact", confidence: 1, platform: "meta", occurred_at: iso(60) },
    timeline: [{ at: iso(54), kind: "customer", label: "Became a customer" }, { at: iso(0), kind: "message", label: "Customer replied on WhatsApp" }],
  };
}

function sparse(): Customer360 {
  return {
    ...rich(),
    identity: { ...rich().identity, id: "c5", name: "Tumi Khumalo", phone: null, email: null, assigned_to: null, assigned_to_name: null },
    counts: { conversations: 0, leads: 0, opportunities: 0, open_opportunities: 0 },
    conversations: [], leads: [], opportunities: [], revenue_by_currency: [], documents: [], notes: [], activity: [], attribution: null, timeline: [],
  };
}

function InboxProbe() {
  const loc = useLocation();
  return <p>INBOX selected={(loc.state as { selectedId?: string } | null)?.selectedId ?? "none"}</p>;
}

const renderRecord = () => render(
  <MemoryRouter initialEntries={["/app/customers/c1"]}>
    <Routes>
      <Route path="/app/customers/:customerId" element={<Customer360Page />} />
      <Route path="/app/whatsapp/inbox" element={<InboxProbe />} />
      <Route path="/app/customers" element={<p>CUSTOMERS LIST</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  state.role = "owner";
  state.data = rich();
  state.loading = false;
  state.error = null;
  state.refetch.mockReset();
  state.requested = [];
  sign.mockReset().mockResolvedValue({ url: "https://signed.example/quote.pdf" });
});
afterEach(cleanup);

describe("Customer record - states", () => {
  it("shows a skeleton while loading", () => {
    state.data = null; state.loading = true;
    renderRecord();
    expect(screen.getByRole("status", { name: "Loading customer" })).toBeInTheDocument();
  });

  it("a load failure offers a retry instead of claiming the customer doesn't exist", () => {
    state.data = null; state.error = new Error("Failed to fetch");
    renderRecord();
    expect(screen.getByText("Couldn't load this customer")).toBeInTheDocument();
    expect(screen.queryByText("Customer not found")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.refetch).toHaveBeenCalled();
  });

  it("a genuinely missing customer says not found", () => {
    state.data = null; state.error = new Error("customer not found");
    renderRecord();
    expect(screen.getByText("Customer not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Customers" })).toHaveAttribute("href", "/app/customers");
  });

  it("without permission nothing is fetched", () => {
    state.role = undefined;
    renderRecord();
    expect(screen.getByText(/You don't have permission to view customers/)).toBeInTheDocument();
    expect(state.requested.every((ws) => ws === null)).toBe(true);
  });
});

describe("Customer record - hierarchy", () => {
  it("identity and contact actions come first", () => {
    renderRecord();
    const idPanel = screen.getByRole("region", { name: "Customer identity" });
    expect(within(idPanel).getByRole("heading", { level: 1, name: "Lerato Mokoena" })).toBeInTheDocument();
    expect(within(idPanel).getByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:+27 82 111 0000");
    expect(within(idPanel).getByRole("link", { name: /WhatsApp/ })).toHaveAttribute("href", "https://wa.me/27821110000");
    expect(within(idPanel).getByRole("link", { name: /Email/ })).toHaveAttribute("href", "mailto:lerato@example.com");
    expect(within(idPanel).getByText("Owner · Thandi Mokoena")).toBeInTheDocument();
  });

  it("open work lists only the open opportunity and the unresolved conversation", () => {
    renderRecord();
    const work = screen.getByRole("region", { name: "Open work" });
    expect(within(work).getByText("Wedding cake")).toBeInTheDocument();
    expect(within(work).getByText("WhatsApp · Lerato")).toBeInTheDocument();
    expect(within(work).queryByText("Birthday cake")).not.toBeInTheDocument();
    expect(within(work).queryByText(/Lerato \(work\)/)).not.toBeInTheDocument();
  });

  it("the timeline is newest first, with notes and team activity a tab away", async () => {
    renderRecord();
    const tl = screen.getByRole("region", { name: "Timeline" });
    const items = within(tl).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("Customer replied on WhatsApp");
    fireEvent.mouseDown(within(tl).getByRole("tab", { name: /Notes/ }), { button: 0 });
    await waitFor(() => expect(within(tl).getByText("Three tiers, gold leaf.")).toBeInTheDocument());
    fireEvent.mouseDown(within(tl).getByRole("tab", { name: /activity/ }), { button: 0 });
    await waitFor(() => expect(within(tl).getByText("Opportunity stage changed")).toBeInTheDocument());
  });

  it("revenue is shown per currency, never summed", () => {
    renderRecord();
    const rel = screen.getByRole("region", { name: "Relationship" });
    expect(within(rel).getByText(/never summed/)).toBeInTheDocument();
    expect(within(rel).getAllByText(/1 event/)).toHaveLength(2);
  });
});

describe("Customer record - linked records", () => {
  it("opening a linked conversation selects it in the inbox (fixes the old conversationId state key)", () => {
    renderRecord();
    const convs = screen.getByRole("region", { name: "Conversations" });
    fireEvent.click(within(convs).getByRole("link", { name: /Lerato \(work\)/ }));
    expect(screen.getByText("INBOX selected=cv2")).toBeInTheDocument();
  });

  it("leads link through only for roles that can view leads", () => {
    renderRecord();
    expect(within(screen.getByRole("region", { name: "Leads" })).getByRole("link", { name: /Open lead L-0042/ })).toHaveAttribute("href", "/app/leads");
  });

  it("documents open through a signed URL", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderRecord();
    fireEvent.click(screen.getByRole("button", { name: "Open Quote.pdf" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://signed.example/quote.pdf", "_blank", "noopener,noreferrer"));
    expect(sign).toHaveBeenCalledWith("w1", "d1");
    open.mockRestore();
  });

  it("with no linked data every section says so plainly - nothing invented", () => {
    state.data = sparse();
    renderRecord();
    expect(screen.getByText(/Nothing open right now/)).toBeInTheDocument();
    expect(screen.getByText("Nothing recorded yet.")).toBeInTheDocument();
    expect(screen.getByText("No linked conversations.")).toBeInTheDocument();
    expect(screen.getByText("No opportunities.")).toBeInTheDocument();
    expect(screen.getByText("No related leads.")).toBeInTheDocument();
    expect(screen.getByText("No documents.")).toBeInTheDocument();
    expect(screen.getByText("No revenue recorded")).toBeInTheDocument();
    expect(screen.getByText(/No phone or email on file/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Call/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Customer identity" })).getByText("No owner")).toBeInTheDocument();
  });
});
