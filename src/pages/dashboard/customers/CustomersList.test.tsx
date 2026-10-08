import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerListRow } from "@/lib/customer";

const state = vi.hoisted(() => ({
  role: "owner",
  rows: [] as CustomerListRow[],
  loading: false,
  error: false,
  refetch: vi.fn(),
  calls: [] as Array<{ ws: string | null; q: string }>,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "w1", currentMembership: { role: state.role } }) }));
vi.mock("@/hooks/useCustomers", () => ({
  useCustomersSearch: (ws: string | null, q: string) => {
    state.calls.push({ ws, q });
    const needle = q.trim().toLowerCase();
    const data = state.error || state.loading ? undefined
      : state.rows.filter((c) => !needle || [c.name, c.phone, c.email, c.company_name].some((v) => (v || "").toLowerCase().includes(needle)));
    return { data, isLoading: state.loading, isError: state.error, isFetching: false, refetch: state.refetch };
  },
}));

import CustomersList from "./CustomersList";

const row = (o: Partial<CustomerListRow>): CustomerListRow => ({
  id: "x", name: "Name", phone: null, email: null, company_name: null, status: "active", customer_since: "2026-08-01T00:00:00Z",
  assigned_to_name: null, open_opportunities: 0, total_opportunities: 0, last_interaction: null, revenue_by_currency: [], ...o,
});

// Fixed, distinct update times so "Recently updated" order is deterministic.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
const ROWS = [
  row({ id: "c1", last_interaction: hoursAgo(1), name: "Lerato Mokoena", company_name: "Celebration Cakes", phone: "+27 82 111 0000", assigned_to_name: "Thandi Mokoena", open_opportunities: 1, total_opportunities: 3, revenue_by_currency: [{ currency: "ZAR", total_minor: 4850000 }] }),
  row({ id: "c2", last_interaction: hoursAgo(2), name: "Sipho Dlamini", company_name: "Dlamini Events", open_opportunities: 1, total_opportunities: 1 }),
  row({ id: "c3", last_interaction: hoursAgo(3), name: "Ayesha Naidoo", status: "inactive", assigned_to_name: "Johan Meyer", total_opportunities: 1 }),
  row({ id: "c4", last_interaction: hoursAgo(4), name: "Tumi Khumalo", company_name: "Khumalo Catering" }),
];

const renderList = () => render(<MemoryRouter><CustomersList /></MemoryRouter>);
const list = () => screen.getByRole("list", { name: "Customers" });
const names = () => within(list()).getAllByRole("link").map((a) => a.textContent ?? "");
const tile = (label: string) => screen.getByText(label, { selector: "p" }).closest("[data-metric-state]") as HTMLElement;

beforeEach(() => {
  state.role = "owner";
  state.rows = ROWS;
  state.loading = false;
  state.error = false;
  state.refetch.mockReset();
  state.calls = [];
});
afterEach(cleanup);

describe("Customers - loading, error and empty states", () => {
  it("shows a skeleton while loading", () => {
    state.loading = true;
    renderList();
    expect(screen.getByRole("status", { name: "Loading customers" })).toBeInTheDocument();
  });

  it("a failed load says so and retries - it never claims there are no customers", () => {
    state.error = true;
    renderList();
    expect(screen.getByText("Couldn't load customers")).toBeInTheDocument();
    expect(screen.queryByText("No customers yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.refetch).toHaveBeenCalled();
  });

  it("no customers at all explains how customers are created and links to Leads", () => {
    state.rows = [];
    renderList();
    expect(screen.getByText("No customers yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Leads" })).toHaveAttribute("href", "/app/leads");
    expect(tile("Customers")).toHaveAttribute("data-metric-state", "zero");
    expect(tile("Revenue recorded")).toHaveAttribute("data-metric-state", "no_data");
  });

  it("a search with no matches is distinguished from having no customers", async () => {
    renderList();
    fireEvent.change(screen.getByRole("textbox", { name: "Search customers" }), { target: { value: "zzz" } });
    expect(await screen.findByText("No customers match")).toBeInTheDocument();
    expect(screen.queryByText("No customers yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    await waitFor(() => expect(names()).toHaveLength(4));
  });
});

describe("Customers - summary and rows", () => {
  it("summarises open work, missing owners and revenue from real rows", () => {
    renderList();
    expect(within(tile("Customers")).getByText("4")).toBeInTheDocument();
    expect(within(tile("Open opportunities")).getByText("2")).toBeInTheDocument();
    expect(within(tile("Without an owner")).getByText("2")).toBeInTheDocument();
    expect(tile("Revenue recorded")).toHaveAttribute("data-metric-state", "value");
    expect(screen.getByText("2 customers have open opportunities · 2 have no owner")).toBeInTheDocument();
  });

  it("rows link to the customer record and show owner, open work and status", () => {
    renderList();
    const lerato = screen.getByRole("link", { name: /Lerato Mokoena/ });
    expect(lerato).toHaveAttribute("href", "/app/customers/c1");
    expect(within(lerato).getByText("1 open")).toBeInTheDocument();
    expect(within(lerato).getByText("Thandi Mokoena")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Sipho Dlamini/ })).getByText("No owner")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Ayesha Naidoo/ })).getByText("Inactive")).toBeInTheDocument();
  });

  it("search is sent to the server after a short pause, scoped to the workspace", async () => {
    renderList();
    fireEvent.change(screen.getByRole("textbox", { name: "Search customers" }), { target: { value: "cater" } });
    await waitFor(() => expect(names()).toHaveLength(1));
    expect(names()[0]).toContain("Tumi Khumalo");
    expect(state.calls.some((c) => c.q === "cater" && c.ws === "w1")).toBe(true);
    // Not one request per keystroke: intermediate prefixes are never queried.
    expect(state.calls.some((c) => c.q === "c" || c.q === "ca")).toBe(false);
  });

  it("the open-work toggle narrows to customers with open opportunities", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Has open work" }));
    expect(names().map((n) => n.split(/Celebration|Dlamini Events/)[0])).toEqual(["Lerato Mokoena", "Sipho Dlamini"]);
  });

  it("filters live in a sheet on smaller screens", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = screen.getByRole("dialog", { name: "Filter customers" });
    fireEvent.click(within(sheet).getByRole("checkbox"));
    expect(within(sheet).getByText("2 customers match")).toBeInTheDocument();
    // The page behind the modal sheet is aria-hidden while it's open.
    expect(screen.getByRole("button", { name: "Filters, 1 active", hidden: true })).toBeInTheDocument();
  });
});

describe("Customers - permissions", () => {
  it("roles without opportunity.view see a permission state and no data is requested", () => {
    state.role = "viewer_without_access";
    renderList();
    expect(screen.getByText(/You don't have permission to view customers/)).toBeInTheDocument();
    expect(state.calls.every((c) => c.ws === null)).toBe(true);
  });
});
