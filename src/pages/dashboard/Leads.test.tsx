import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LeadRow } from "@/hooks/useLeads";

const NOW = Date.now();
const iso = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();

const state = vi.hoisted(() => ({
  role: "owner",
  leads: [] as LeadRow[],
  leadsLoading: false,
  leadsError: false,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "w1", currentMembership: { role: state.role }, user: { id: "me" } }) }));
vi.mock("@/hooks/useLeads", () => ({
  usePipelines: () => ({ data: [{ id: "p1", name: "Sales", is_default: true, is_active: true }], isLoading: false }),
  useLeads: () => ({ data: state.leadsError ? undefined : state.leads, isLoading: state.leadsLoading, isError: state.leadsError, refetch: state.refetch }),
  useAllPipelineStages: () => [
    { id: "s1", pipeline_id: "p1", name: "New", sort_order: 1, is_active: true, is_won_stage: false, is_lost_stage: false },
    { id: "s2", pipeline_id: "p1", name: "Proposal sent", sort_order: 2, is_active: true, is_won_stage: false, is_lost_stage: false },
  ],
  usePipelineStages: () => ({ data: [
    { id: "s1", pipeline_id: "p1", name: "New", sort_order: 1, is_active: true, is_won_stage: false, is_lost_stage: false },
    { id: "s2", pipeline_id: "p1", name: "Proposal sent", sort_order: 2, is_active: true, is_won_stage: false, is_lost_stage: false },
  ] }),
}));
vi.mock("@/hooks/useWorkspaceMembers", () => ({
  useWorkspaceMembers: () => ({ data: [{ user_id: "me", profile: { full_name: "Thandi Mokoena" } }, { user_id: "u2", profile: { full_name: "Johan Meyer" } }] }),
}));
vi.mock("@/hooks/useOpportunityTerminology", () => ({ useOpportunityTerminology: () => "Opportunity" }));
vi.mock("@/pages/dashboard/leads/LeadDetail", () => ({ LeadDetail: ({ leadId }: { leadId: string }) => <div role="dialog">LEAD DETAIL {leadId}</div> }));
vi.mock("@/pages/dashboard/leads/NewLeadDialog", () => ({ NewLeadDialog: () => <button type="button">Add lead</button> }));
vi.mock("@/pages/dashboard/leads/PipelineSettings", () => ({ PipelineSettings: () => <div>PIPELINE SETTINGS</div> }));

import Leads from "./Leads";

function lead(overrides: Partial<LeadRow>): LeadRow {
  return {
    id: "l1", human_reference: "L-0001", contact_name: "Lerato Mokoena", phone: "+27821110000", email: null, company_name: null,
    source: "whatsapp", source_detail: null, status: "active", assigned_to: null, pipeline_id: "p1", pipeline_stage_id: "s1",
    qualification_status: "unqualified", qualification_notes: null, qualification_reason: null, estimated_value: null, summary: null,
    created_from_conversation_id: null, lost_reason: null, created_at: iso(-60 * 24 * 5), updated_at: iso(-60),
    converted_at: null, lost_at: null, next_follow_up_at: null, follow_up_note: null, follow_up_completed_at: null, archived_at: null,
    ...overrides,
  };
}

const LEADS = [
  lead({ id: "a", contact_name: "Lerato Mokoena", company_name: "Celebration cakes", assigned_to: "me", pipeline_stage_id: "s2", next_follow_up_at: iso(-60 * 50), follow_up_note: "Call about cake wording", estimated_value: 4500 }),
  lead({ id: "b", contact_name: "Sipho Dlamini", source: "website", assigned_to: null }),
  lead({ id: "c", contact_name: "Ayesha Naidoo", source: "referral", assigned_to: "u2", qualification_status: "qualified", next_follow_up_at: iso(60 * 24 * 3) }),
  lead({ id: "d", contact_name: "Tumi Khumalo", assigned_to: "u2", updated_at: iso(-60 * 24 * 12) }),
  lead({ id: "e", contact_name: "Johan Old", status: "converted", assigned_to: "u2" }),
  lead({ id: "f", contact_name: "Archived Person", archived_at: iso(-60 * 24) }),
];

const renderLeads = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><Leads /></MemoryRouter></QueryClientProvider>);
const rowFor = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
const tile = (label: string) => screen.getByText(label, { selector: "p" }).closest("[data-metric-state]") as HTMLElement;

beforeEach(() => {
  state.role = "owner";
  state.leads = LEADS;
  state.leadsLoading = false;
  state.leadsError = false;
  state.refetch.mockReset();
});
afterEach(cleanup);

describe("Leads - loading, error and empty states", () => {
  it("shows a layout skeleton while leads load", () => {
    state.leadsLoading = true;
    renderLeads();
    expect(screen.getByRole("status", { name: "Loading leads" })).toBeInTheDocument();
  });

  it("explains a failed load instead of claiming there are no leads", () => {
    state.leadsError = true;
    renderLeads();
    expect(screen.getByText("Couldn't load leads")).toBeInTheDocument();
    expect(screen.queryByText("No leads yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.refetch).toHaveBeenCalled();
  });

  it("no leads at all: explains where leads come from and offers Add lead", () => {
    state.leads = [];
    renderLeads();
    expect(screen.getByText("No leads yet")).toBeInTheDocument();
    expect(tile("Open leads")).toHaveAttribute("data-metric-state", "zero");
  });

  it("a filter with no matches says so and offers to clear filters", () => {
    renderLeads();
    fireEvent.change(screen.getByRole("textbox", { name: "Search leads" }), { target: { value: "nobody-matches" } });
    expect(screen.getByText("No leads match these filters")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Clear filters/ })[0]);
    expect(rowFor("Lerato Mokoena")).toBeInTheDocument();
  });
});

describe("Leads - summary metrics", () => {
  it("counts open work from the loaded leads (archived and closed excluded from open)", () => {
    renderLeads();
    expect(within(tile("Open leads")).getByText("4")).toBeInTheDocument();
    expect(within(tile("Unassigned")).getByText("1")).toBeInTheDocument();
    expect(within(tile("Follow-up due")).getByText("1")).toBeInTheDocument();
    expect(within(tile("Follow-up due")).getByText("1 overdue · 0 today")).toBeInTheDocument();
    expect(within(tile("Converted")).getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/1 follow-up is due or overdue · 1 lead has no owner/)).toBeInTheDocument();
  });
});

describe("Leads - rows show what needs attention", () => {
  it("defaults to open leads, sorted by follow-up soonest", () => {
    renderLeads();
    const names = within(screen.getByRole("list", { name: "Leads" })).getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names[0]).toContain("Lerato Mokoena");
    expect(names[1]).toContain("Ayesha Naidoo");
    expect(names.join(" ")).not.toContain("Archived Person");
    expect(names.join(" ")).not.toContain("Johan Old");
  });

  it("presents stage, owner, follow-up state and staleness", () => {
    renderLeads();
    const lerato = rowFor("Lerato Mokoena");
    expect(within(lerato).getByText("Proposal sent")).toBeInTheDocument();
    expect(within(lerato).getByText("Thandi Mokoena")).toBeInTheDocument();
    expect(within(lerato).getByText(/^Overdue/)).toBeInTheDocument();
    expect(within(rowFor("Sipho Dlamini")).getByText("Unassigned")).toBeInTheDocument();
    expect(within(rowFor("Sipho Dlamini")).getByText("No follow-up scheduled")).toBeInTheDocument();
    expect(within(rowFor("Ayesha Naidoo")).getByText(/^Follow up/)).toBeInTheDocument();
    expect(within(rowFor("Tumi Khumalo")).getByText(/Stale · 12d/)).toBeInTheDocument();
  });

  it("search narrows the list", () => {
    renderLeads();
    fireEvent.change(screen.getByRole("textbox", { name: "Search leads" }), { target: { value: "celebration" } });
    const rows = within(screen.getByRole("list", { name: "Leads" })).getAllByRole("button");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Lerato Mokoena");
  });

  it("source chips filter by where leads came from and can be cleared", () => {
    renderLeads();
    fireEvent.click(screen.getByRole("button", { name: /^Website 1$/ }));
    const rows = within(screen.getByRole("list", { name: "Leads" })).getAllByRole("button");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Sipho Dlamini");
    expect(screen.getByRole("button", { name: /^Website 1$/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the lead detail from a row", () => {
    renderLeads();
    fireEvent.click(rowFor("Ayesha Naidoo"));
    expect(screen.getByText("LEAD DETAIL c")).toBeInTheDocument();
  });

  it("keeps the Board view available", () => {
    renderLeads();
    fireEvent.click(screen.getByRole("button", { name: "board" }));
    expect(screen.getByRole("list", { name: "Pipeline stages" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Proposal sent, 1 leads" })).toBeInTheDocument();
  });
});

describe("Leads - permissions", () => {
  it("hides Add lead and Pipelines from roles without those permissions", () => {
    state.role = "viewer";
    renderLeads();
    expect(screen.queryByRole("button", { name: "Add lead" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pipelines/ })).not.toBeInTheDocument();
  });

  it("owners see both", () => {
    renderLeads();
    expect(screen.getAllByRole("button", { name: "Add lead" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Pipelines/ })).toBeInTheDocument();
  });
});
