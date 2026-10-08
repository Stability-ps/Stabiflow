import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sheet } from "@/components/ui/sheet";
import type { LeadRow } from "@/hooks/useLeads";

const NOW = Date.now();
const iso = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();

const state = vi.hoisted(() => ({ lead: null as LeadRow | null, notes: [] as Array<Record<string, unknown>> }));
const actions = vi.hoisted(() => ({ completeLeadFollowUp: vi.fn(), setLeadFollowUp: vi.fn(), addCrmNote: vi.fn() }));

vi.mock("@/hooks/useLeads", () => ({
  useLead: () => ({ data: state.lead }),
  useLeadAttachments: () => ({ data: [] }),
  usePipelineStages: () => ({ data: [{ id: "s1", pipeline_id: "p1", name: "Proposal sent", sort_order: 1, is_active: true, is_won_stage: false, is_lost_stage: false }] }),
}));
vi.mock("@/hooks/useWorkspaceMembers", () => ({ useWorkspaceMembers: () => ({ data: [{ user_id: "me", profile: { full_name: "Thandi Mokoena" } }] }) }));
vi.mock("@/hooks/useOpportunities", () => ({
  useOpportunitiesForLead: () => ({ data: [] }),
  useCrmNotes: () => ({ data: state.notes }),
  useCustomerForOpportunity: () => ({ data: null }),
  useCustomerForLead: () => ({ data: null }),
}));
vi.mock("@/components/attribution/AttributionSourceSummary", () => ({ AttributionSourceSummary: () => <p>No attribution evidence recorded.</p> }));
vi.mock("@/components/attribution/RevenueSection", () => ({ RevenueSection: () => null }));
vi.mock("@/lib/leads", async (orig) => ({ ...(await orig<typeof import("@/lib/leads")>()), ...actions }));

import { LeadDetail } from "./LeadDetail";

function lead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "l1", human_reference: "L-0042", contact_name: "Lerato Mokoena", phone: "+27821110000", email: "lerato@example.com", company_name: "Celebration cakes",
    source: "whatsapp", source_detail: null, status: "active", assigned_to: "me", pipeline_id: "p1", pipeline_stage_id: "s1",
    qualification_status: "qualified", qualification_notes: null, qualification_reason: null, estimated_value: 4500, summary: null, intake: {},
    created_from_conversation_id: null, lost_reason: null, created_at: iso(-60 * 24 * 5), updated_at: iso(-60),
    converted_at: null, lost_at: null, next_follow_up_at: null, follow_up_note: null, follow_up_completed_at: null, archived_at: null,
    ...overrides,
  };
}

function renderDetail(perms: Partial<{ canEdit: boolean; canAssign: boolean }> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Sheet open>
          <LeadDetail
            workspaceId="w1" leadId="l1" canEdit={perms.canEdit ?? true} canAssign={perms.canAssign ?? true} canViewAttachments={false}
            canCreateOpportunity canCloseOpportunity canRecordRevenue canArchive opportunityLabel="Opportunity"
          />
        </Sheet>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.lead = lead();
  state.notes = [];
  Object.values(actions).forEach((a) => a.mockReset().mockResolvedValue({ ok: true }));
});
afterEach(cleanup);

describe("LeadDetail - next action", () => {
  it("says plainly when no follow-up is scheduled", () => {
    renderDetail();
    const next = screen.getByRole("region", { name: "Next action" });
    expect(within(next).getByText("No follow-up scheduled")).toBeInTheDocument();
    expect(within(next).queryByRole("button", { name: /Mark follow-up done/ })).not.toBeInTheDocument();
  });

  it("makes an overdue follow-up and its note obvious, with a done action", async () => {
    state.lead = lead({ next_follow_up_at: iso(-60 * 50), follow_up_note: "Call about cake wording" });
    renderDetail();
    const next = screen.getByRole("region", { name: "Next action" });
    expect(within(next).getByText(/Follow-up overdue by 2 days/)).toBeInTheDocument();
    expect(within(next).getByText("Call about cake wording")).toBeInTheDocument();
    fireEvent.click(within(next).getByRole("button", { name: /Mark follow-up done/ }));
    await waitFor(() => expect(actions.completeLeadFollowUp).toHaveBeenCalledWith("w1", "l1"));
  });

  it("closed leads have no next-action block", () => {
    state.lead = lead({ status: "converted" });
    renderDetail();
    expect(screen.queryByRole("region", { name: "Next action" })).not.toBeInTheDocument();
  });
});

describe("LeadDetail - permissions", () => {
  it("without edit/assign permission the follow-up, owner and stage are read-only", () => {
    state.lead = lead({ next_follow_up_at: iso(60 * 24 * 2) });
    renderDetail({ canEdit: false, canAssign: false });
    expect(screen.queryByRole("button", { name: /Mark follow-up done/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Follow-up note" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Owner" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Pipeline stage" })).not.toBeInTheDocument();
    const details = screen.getByRole("region", { name: "Details" });
    expect(within(details).getByText("Thandi Mokoena")).toBeInTheDocument();
    expect(within(details).getByText("Proposal sent")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Qualification" })).not.toBeInTheDocument();
  });

  it("with edit permission the follow-up can be scheduled and owner/stage changed", () => {
    renderDetail();
    expect(screen.getByRole("textbox", { name: "Follow-up note" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Owner" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Pipeline stage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mark lead lost/ })).toBeInTheDocument();
  });
});

describe("LeadDetail - activity and notes", () => {
  it("shows notes prominently with author and time, and adds new ones", async () => {
    state.notes = [{ id: "n1", author_name: "Thandi Mokoena", body: "Sent quote for 2-tier cake.", created_at: iso(-60 * 24) }];
    renderDetail();
    const activity = screen.getByRole("region", { name: "Activity and notes" });
    expect(within(activity).getByText("Sent quote for 2-tier cake.")).toBeInTheDocument();
    fireEvent.change(within(activity).getByRole("textbox", { name: "Add a note" }), { target: { value: "Called, no answer" } });
    fireEvent.click(within(activity).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(actions.addCrmNote).toHaveBeenCalled());
  });
});
