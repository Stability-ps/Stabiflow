import { describe, expect, it } from "vitest";
import type { CustomerListRow } from "@/lib/customer";
import {
  DEFAULT_CUSTOMER_FILTERS, customerFiltersActive, filterCustomers, initials, isNotAuthorizedError, isNotFoundError, newestFirst, openWork, ownerNames,
  sortCustomers, sumRevenueByCurrency, summarizeCustomers,
} from "./customersWorkspace";

const row = (o: Partial<CustomerListRow>): CustomerListRow => ({
  id: "x", name: "Name", phone: null, email: null, company_name: null, status: "active", customer_since: "2026-08-01T00:00:00Z",
  assigned_to_name: null, open_opportunities: 0, total_opportunities: 0, last_interaction: null, revenue_by_currency: [], ...o,
});

const ROWS = [
  row({ id: "a", name: "Lerato", assigned_to_name: "Thandi", open_opportunities: 1, total_opportunities: 2, last_interaction: "2026-10-07T08:00:00Z", customer_since: "2026-08-01T00:00:00Z", revenue_by_currency: [{ currency: "ZAR", total_minor: 1000 }] }),
  row({ id: "b", name: "Ayesha", status: "inactive", assigned_to_name: "Johan", last_interaction: "2026-09-01T08:00:00Z", customer_since: "2026-09-15T00:00:00Z", revenue_by_currency: [{ currency: "ZAR", total_minor: 500 }, { currency: "USD", total_minor: 200 }] }),
  row({ id: "c", name: "Tumi", open_opportunities: 2, total_opportunities: 2, last_interaction: null }),
];

describe("filterCustomers", () => {
  it("defaults to everyone", () => {
    expect(filterCustomers(ROWS, DEFAULT_CUSTOMER_FILTERS).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(customerFiltersActive(DEFAULT_CUSTOMER_FILTERS)).toBe(false);
  });
  it("filters by status, owner, no owner and open work", () => {
    expect(filterCustomers(ROWS, { ...DEFAULT_CUSTOMER_FILTERS, status: "inactive" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterCustomers(ROWS, { ...DEFAULT_CUSTOMER_FILTERS, owner: "Thandi" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterCustomers(ROWS, { ...DEFAULT_CUSTOMER_FILTERS, owner: "none" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterCustomers(ROWS, { ...DEFAULT_CUSTOMER_FILTERS, openOnly: true }).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("sortCustomers", () => {
  it("recently updated first, with no-date rows last", () => {
    expect(sortCustomers(ROWS, "updated").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("by name, newest customer and most open work", () => {
    expect(sortCustomers(ROWS, "name").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortCustomers(ROWS, "newest")[0].id).toBe("b");
    expect(sortCustomers(ROWS, "open").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});

describe("summarizeCustomers", () => {
  it("counts open work and missing owners, and sums revenue per currency without mixing currencies", () => {
    const s = summarizeCustomers(ROWS);
    expect(s).toMatchObject({ total: 3, withOpen: 2, noOwner: 1 });
    expect(s.revenue).toEqual([{ currency: "ZAR", total_minor: 1500 }, { currency: "USD", total_minor: 200 }]);
  });
  it("no revenue events means an empty list, not a zero amount", () => {
    expect(sumRevenueByCurrency([[], []])).toEqual([]);
  });
});

describe("helpers", () => {
  it("owner names are unique and sorted", () => {
    expect(ownerNames(ROWS)).toEqual(["Johan", "Thandi"]);
  });
  it("initials", () => {
    expect(initials("Nomvula Thandiwe Mokoena-van der Merwe")).toBe("NM");
    expect(initials("Tumi")).toBe("T");
    expect(initials("  ")).toBe("?");
  });
  it("recognises the RPC's not-found and not-authorized errors", () => {
    expect(isNotFoundError(new Error("customer not found"))).toBe(true);
    expect(isNotFoundError(new Error("Failed to fetch"))).toBe(false);
    expect(isNotAuthorizedError(new Error("not authorized"))).toBe(true);
  });
  it("newestFirst sinks missing dates", () => {
    expect(newestFirst([{ at: null }, { at: "2026-10-01" }, { at: "2026-10-05" }], (x) => x.at).map((x) => x.at)).toEqual(["2026-10-05", "2026-10-01", null]);
  });
});

describe("openWork", () => {
  it("lists unresolved conversations and open opportunities only", () => {
    const work = openWork({
      conversations: [
        { id: "cv1", display_name: "Lerato", phone_number: "+27", inbox_status: "unassigned", ai_enabled: false, assigned_staff_name: null } as never,
        { id: "cv2", display_name: null, phone_number: "+27 82", inbox_status: "resolved", ai_enabled: true, assigned_staff_name: null } as never,
      ],
      opportunities: [
        { id: "o1", title: "Wedding cake", status: "open", pipeline_name: "Sales", stage_name: "Proposal", owner_name: "Thandi" } as never,
        { id: "o2", title: "Old order", status: "won", pipeline_name: "Sales", stage_name: "Won", owner_name: null } as never,
      ],
    });
    expect(work.map((w) => w.id)).toEqual(["cv1", "o1"]);
    expect(work[0].meta).toBe("Human handling - nobody assigned");
    expect(work[1].meta).toBe("Sales · Proposal · Thandi");
  });
});
