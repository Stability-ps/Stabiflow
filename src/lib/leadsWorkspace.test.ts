import { describe, expect, it } from "vitest";
import type { LeadRow } from "@/hooks/useLeads";
import {
  DEFAULT_LEAD_FILTERS, filterLeads, filtersActive, followUpLabel, followUpState, leadSources, sortLeads, staleDays, summarizeLeads,
} from "./leadsWorkspace";

const NOW = new Date("2026-10-07T12:00:00");
const iso = (d: string) => new Date(d).toISOString();

function lead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "l1", human_reference: "L-0001", contact_name: "Lerato Mokoena", phone: "+27821110000", email: null, company_name: null,
    source: "whatsapp", source_detail: null, status: "active", assigned_to: null, pipeline_id: "p1", pipeline_stage_id: "s1",
    qualification_status: "unqualified", qualification_notes: null, qualification_reason: null, estimated_value: null, summary: null,
    created_from_conversation_id: null, lost_reason: null, created_at: iso("2026-10-01T09:00:00"), updated_at: iso("2026-10-06T09:00:00"),
    converted_at: null, lost_at: null, next_follow_up_at: null, follow_up_note: null, follow_up_completed_at: null, archived_at: null,
    ...overrides,
  };
}

describe("followUpState - only what the data says", () => {
  it("no follow-up scheduled", () => {
    expect(followUpState(lead(), NOW)).toEqual({ kind: "none" });
    expect(followUpLabel({ kind: "none" })).toBe("No follow-up scheduled");
  });
  it("overdue by days, overdue earlier today, due later today, upcoming", () => {
    expect(followUpState(lead({ next_follow_up_at: iso("2026-10-05T09:00:00") }), NOW)).toMatchObject({ kind: "overdue", days: 2 });
    expect(followUpState(lead({ next_follow_up_at: iso("2026-10-07T09:00:00") }), NOW)).toMatchObject({ kind: "overdue", days: 0 });
    expect(followUpState(lead({ next_follow_up_at: iso("2026-10-07T16:00:00") }), NOW).kind).toBe("due_today");
    expect(followUpState(lead({ next_follow_up_at: iso("2026-10-09T10:00:00") }), NOW).kind).toBe("upcoming");
  });
  it("closed or archived leads have no actionable follow-up", () => {
    expect(followUpState(lead({ status: "converted", next_follow_up_at: iso("2026-10-05T09:00:00") }), NOW).kind).toBe("none");
    expect(followUpState(lead({ archived_at: iso("2026-10-06T09:00:00"), next_follow_up_at: iso("2026-10-05T09:00:00") }), NOW).kind).toBe("none");
  });
});

describe("staleDays", () => {
  it("flags an active lead with no follow-up and no update for 7+ days", () => {
    expect(staleDays(lead({ updated_at: iso("2026-09-25T12:00:00") }), NOW)).toBe(12);
    expect(staleDays(lead({ updated_at: iso("2026-10-05T12:00:00") }), NOW)).toBeNull();
  });
  it("a scheduled follow-up means the lead is not stale", () => {
    expect(staleDays(lead({ updated_at: iso("2026-09-01T12:00:00"), next_follow_up_at: iso("2026-10-09T10:00:00") }), NOW)).toBeNull();
  });
});

describe("filterLeads", () => {
  const leads = [
    lead({ id: "a", contact_name: "Lerato", assigned_to: "me", source: "whatsapp", pipeline_stage_id: "s1" }),
    lead({ id: "b", contact_name: "Sipho", company_name: "Dlamini Events", assigned_to: null, source: "website", pipeline_stage_id: "s2" }),
    lead({ id: "c", contact_name: "Ayesha", assigned_to: "other", status: "converted" }),
    lead({ id: "d", contact_name: "Tumi", archived_at: iso("2026-10-01T00:00:00") }),
    lead({ id: "e", contact_name: "Johan", qualification_status: "qualified", next_follow_up_at: iso("2026-10-01T09:00:00") }),
  ];
  const ctx = { now: NOW, userId: "me" };
  const ids = (f: Partial<typeof DEFAULT_LEAD_FILTERS>) => filterLeads(leads, { ...DEFAULT_LEAD_FILTERS, ...f }, ctx).map((l) => l.id);

  it("default view is open (active, not archived) work", () => expect(ids({})).toEqual(["a", "b", "e"]));
  it("archived only under Archived", () => expect(ids({ view: "archived" })).toEqual(["d"]));
  it("views: converted, qualified, overdue, follow-up", () => {
    expect(ids({ view: "converted" })).toEqual(["c"]);
    expect(ids({ view: "qualified" })).toEqual(["e"]);
    expect(ids({ view: "overdue" })).toEqual(["e"]);
    expect(ids({ view: "follow_up" })).toEqual(["e"]);
  });
  it("search matches name, company, phone and reference", () => {
    expect(ids({ search: "dlamini" })).toEqual(["b"]);
    expect(ids({ search: "L-0001" })).toEqual(["a", "b", "e"]);
  });
  it("owner: me, unassigned, a person", () => {
    expect(ids({ owner: "me" })).toEqual(["a"]);
    expect(ids({ owner: "unassigned" })).toEqual(["b", "e"]);
    expect(ids({ view: "all", owner: "other" })).toEqual(["c"]);
  });
  it("stage and source", () => {
    expect(ids({ stage: "s2" })).toEqual(["b"]);
    expect(ids({ source: "website" })).toEqual(["b"]);
  });
  it("knows when filters differ from the default", () => {
    expect(filtersActive(DEFAULT_LEAD_FILTERS)).toBe(false);
    expect(filtersActive({ ...DEFAULT_LEAD_FILTERS, owner: "me" })).toBe(true);
  });
});

describe("sortLeads", () => {
  const leads = [
    lead({ id: "a", next_follow_up_at: iso("2026-10-09T10:00:00"), estimated_value: 100, updated_at: iso("2026-10-01T00:00:00") }),
    lead({ id: "b", next_follow_up_at: null, estimated_value: null, updated_at: iso("2026-10-06T00:00:00") }),
    lead({ id: "c", next_follow_up_at: iso("2026-10-02T10:00:00"), estimated_value: 5000, updated_at: iso("2026-10-03T00:00:00") }),
  ];
  it("follow-up soonest puts overdue first and unscheduled last", () => expect(sortLeads(leads, "follow_up").map((l) => l.id)).toEqual(["c", "a", "b"]));
  it("value high to low, unknown value last", () => expect(sortLeads(leads, "value").map((l) => l.id)).toEqual(["c", "a", "b"]));
  it("recently updated", () => expect(sortLeads(leads, "updated").map((l) => l.id)).toEqual(["b", "c", "a"]));
});

describe("summarizeLeads", () => {
  it("counts open work, follow-ups, qualification and conversions - archived excluded", () => {
    const s = summarizeLeads([
      lead({ assigned_to: null, next_follow_up_at: iso("2026-10-05T09:00:00") }),
      lead({ assigned_to: "x", qualification_status: "qualified", next_follow_up_at: iso("2026-10-07T17:00:00") }),
      lead({ status: "converted" }),
      lead({ status: "lost" }),
      lead({ archived_at: iso("2026-10-01T00:00:00") }),
    ], NOW);
    expect(s).toEqual({ open: 2, unassigned: 1, overdue: 1, dueToday: 1, qualified: 1, converted: 1 });
  });
  it("an empty workspace is a measured zero, not missing", () => {
    expect(summarizeLeads([], NOW)).toEqual({ open: 0, unassigned: 0, overdue: 0, dueToday: 0, qualified: 0, converted: 0 });
  });
  it("lists distinct sources", () => {
    expect(leadSources([lead({ source: "website" }), lead({ source: "whatsapp" }), lead({ source: "website" })])).toEqual(["website", "whatsapp"]);
  });
});
