// Pure presentation logic for the Customers workspace. Everything is derived
// from what the customers_search / customer_360 RPCs return - nothing is
// invented (no health score, no "last contacted" made up from unrelated
// timestamps, no summed currencies).
import type { Customer360, CustomerListRow, RevenueByCurrency } from "@/lib/customer";
import { formatMinor } from "@/lib/customer";

export type CustomerStatusFilter = "any" | "active" | "inactive" | "archived";
export type CustomerSort = "updated" | "name" | "newest" | "open";
export type CustomerFilters = {
  status: CustomerStatusFilter;
  /** "any" | "none" | an owner's display name (the list RPC returns names, not ids) */
  owner: string;
  openOnly: boolean;
};

export const DEFAULT_CUSTOMER_FILTERS: CustomerFilters = { status: "any", owner: "any", openOnly: false };

export function customerFiltersActive(f: CustomerFilters): boolean {
  return f.status !== "any" || f.owner !== "any" || f.openOnly;
}

export function filterCustomers(rows: CustomerListRow[], f: CustomerFilters): CustomerListRow[] {
  return rows.filter((c) => {
    if (f.status !== "any" && c.status !== f.status) return false;
    if (f.owner === "none" && c.assigned_to_name) return false;
    if (f.owner !== "any" && f.owner !== "none" && c.assigned_to_name !== f.owner) return false;
    if (f.openOnly && c.open_opportunities === 0) return false;
    return true;
  });
}

export function sortCustomers(rows: CustomerListRow[], sort: CustomerSort): CustomerListRow[] {
  const copy = [...rows];
  const t = (iso: string | null) => (iso ? new Date(iso).getTime() : Number.NEGATIVE_INFINITY);
  switch (sort) {
    case "updated":
      return copy.sort((a, b) => t(b.last_interaction) - t(a.last_interaction));
    case "newest":
      return copy.sort((a, b) => t(b.customer_since) - t(a.customer_since));
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case "open":
      return copy.sort((a, b) => b.open_opportunities - a.open_opportunities || t(b.last_interaction) - t(a.last_interaction));
  }
}

export type CustomerSummary = { total: number; withOpen: number; noOwner: number; revenue: RevenueByCurrency[] };

/** Sums revenue per currency - currencies are never added together. */
export function sumRevenueByCurrency(lists: Array<Array<{ currency: string; total_minor: number }>>): RevenueByCurrency[] {
  const by = new Map<string, number>();
  for (const list of lists) for (const r of list) by.set(r.currency, (by.get(r.currency) ?? 0) + Number(r.total_minor));
  return [...by.entries()].map(([currency, total_minor]) => ({ currency, total_minor })).sort((a, b) => b.total_minor - a.total_minor);
}

export function summarizeCustomers(rows: CustomerListRow[]): CustomerSummary {
  return {
    total: rows.length,
    withOpen: rows.filter((c) => c.open_opportunities > 0).length,
    noOwner: rows.filter((c) => !c.assigned_to_name).length,
    revenue: sumRevenueByCurrency(rows.map((c) => c.revenue_by_currency ?? [])),
  };
}

export function formatRevenue(list: Array<{ currency: string; total_minor: number }>): string | null {
  return list.length ? list.map((r) => formatMinor(r.currency, Number(r.total_minor))).join(" · ") : null;
}

export function ownerNames(rows: CustomerListRow[]): string[] {
  return [...new Set(rows.map((c) => c.assigned_to_name).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function customerStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// --- Customer record -------------------------------------------------------

export type OpenWorkItem =
  | { kind: "opportunity"; id: string; title: string; meta: string }
  | { kind: "conversation"; id: string; title: string; meta: string; status: string };

/**
 * What's open on this customer right now: open opportunities and
 * conversations that aren't resolved. Straight from the record - nothing
 * inferred.
 */
export function openWork(data: Pick<Customer360, "opportunities" | "conversations">): OpenWorkItem[] {
  const opps: OpenWorkItem[] = data.opportunities
    .filter((o) => o.status === "open")
    .map((o) => ({
      kind: "opportunity",
      id: o.id,
      title: o.title,
      meta: [o.pipeline_name && o.stage_name ? `${o.pipeline_name} · ${o.stage_name}` : o.stage_name || o.pipeline_name, o.owner_name].filter(Boolean).join(" · "),
    }));
  const convs: OpenWorkItem[] = data.conversations
    .filter((c) => c.inbox_status !== "resolved")
    .map((c) => ({
      kind: "conversation",
      id: c.id,
      title: c.display_name || c.phone_number,
      status: c.inbox_status,
      meta: c.ai_enabled ? "AI handling" : c.assigned_staff_name ? `With ${c.assigned_staff_name}` : "Human handling - nobody assigned",
    }));
  return [...convs, ...opps];
}

export function conversationTone(inboxStatus: string): "warning" | "info" | "neutral" | "success" {
  if (inboxStatus === "new" || inboxStatus === "unassigned") return "warning";
  if (inboxStatus === "assigned") return "info";
  if (inboxStatus === "resolved") return "success";
  return "neutral";
}

export function opportunityTone(status: string): "info" | "success" | "danger" | "neutral" {
  if (status === "open") return "info";
  if (status === "won") return "success";
  if (status === "lost") return "danger";
  return "neutral";
}

/** Most recent first; entries without a valid date sink to the end. */
export function newestFirst<T>(items: T[], at: (item: T) => string | null | undefined): T[] {
  const t = (iso: string | null | undefined) => {
    const n = iso ? new Date(iso).getTime() : NaN;
    return Number.isNaN(n) ? Number.NEGATIVE_INFINITY : n;
  };
  return [...items].sort((a, b) => t(at(b)) - t(at(a)));
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /customer not found/i.test(error.message);
}

export function isNotAuthorizedError(error: unknown): boolean {
  return error instanceof Error && /not authorized/i.test(error.message);
}
