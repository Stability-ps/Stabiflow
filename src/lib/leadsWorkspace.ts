// Pure presentation logic for the Leads workspace: follow-up state,
// staleness, filtering, sorting and the summary counts. Everything is
// derived from fields the leads list already loads - nothing is inferred
// that the data doesn't say (no invented follow-ups, no invented activity).
import type { LeadRow } from "@/hooks/useLeads";

const DAY = 86_400_000;
/** An active lead with no follow-up scheduled and no update for this long is "stale". */
export const STALE_AFTER_DAYS = 7;

export function leadDisplayName(lead: Pick<LeadRow, "contact_name" | "phone" | "human_reference">): string {
  return lead.contact_name || lead.phone || lead.human_reference;
}

export type FollowUpState =
  | { kind: "none" }
  | { kind: "overdue"; days: number; at: Date }
  | { kind: "due_today"; at: Date }
  | { kind: "upcoming"; at: Date };

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Follow-up state from `next_follow_up_at` (completing a follow-up clears
 * it server-side, so a value means "still pending"). Only active,
 * non-archived leads have an actionable follow-up.
 */
export function followUpState(lead: Pick<LeadRow, "status" | "archived_at" | "next_follow_up_at">, now: Date): FollowUpState {
  if (lead.status !== "active" || lead.archived_at || !lead.next_follow_up_at) return { kind: "none" };
  const at = new Date(lead.next_follow_up_at);
  if (Number.isNaN(at.getTime())) return { kind: "none" };
  if (at.getTime() < now.getTime()) {
    return { kind: "overdue", at, days: sameLocalDay(at, now) ? 0 : Math.max(1, Math.floor((now.getTime() - at.getTime()) / DAY)) };
  }
  if (sameLocalDay(at, now)) return { kind: "due_today", at };
  return { kind: "upcoming", at };
}

export function followUpLabel(state: FollowUpState): string {
  switch (state.kind) {
    case "none":
      return "No follow-up scheduled";
    case "overdue":
      return state.days === 0 ? "Overdue" : `Overdue ${state.days}d`;
    case "due_today":
      return `Due today ${state.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    case "upcoming":
      return state.at.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
}

/** Days since the last update when an active lead has gone quiet (no follow-up, no update for STALE_AFTER_DAYS); otherwise null. */
export function staleDays(lead: Pick<LeadRow, "status" | "archived_at" | "next_follow_up_at" | "updated_at">, now: Date): number | null {
  if (lead.status !== "active" || lead.archived_at || lead.next_follow_up_at) return null;
  const days = Math.floor((now.getTime() - new Date(lead.updated_at).getTime()) / DAY);
  return days >= STALE_AFTER_DAYS ? days : null;
}

export function relativeAge(iso: string, now: Date): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export type LeadView = "all" | "active" | "qualified" | "follow_up" | "overdue" | "converted" | "lost" | "archived";
export type LeadSort = "updated" | "follow_up" | "value" | "newest";
export type LeadFilters = {
  view: LeadView;
  search: string;
  /** "any" or a pipeline_stage_id */
  stage: string;
  /** "any" | "me" | "unassigned" | user id */
  owner: string;
  /** "any" or a source value */
  source: string;
};

export const DEFAULT_LEAD_FILTERS: LeadFilters = { view: "active", search: "", stage: "any", owner: "any", source: "any" };

export function filtersActive(f: LeadFilters): boolean {
  return f.view !== DEFAULT_LEAD_FILTERS.view || !!f.search.trim() || f.stage !== "any" || f.owner !== "any" || f.source !== "any";
}

function matchesView(l: LeadRow, view: LeadView, now: Date): boolean {
  // Archived leads appear only under "Archived" - every other view is active work.
  if (view === "archived") return !!l.archived_at;
  if (l.archived_at) return false;
  switch (view) {
    case "all":
      return true;
    case "active":
      return l.status === "active";
    case "converted":
      return l.status === "converted";
    case "lost":
      return l.status === "lost";
    case "qualified":
      return l.status === "active" && l.qualification_status === "qualified";
    case "follow_up":
      return l.status === "active" && !!l.next_follow_up_at;
    case "overdue":
      return followUpState(l, now).kind === "overdue";
  }
}

export function filterLeads(leads: LeadRow[], f: LeadFilters, ctx: { now: Date; userId: string | null }): LeadRow[] {
  const q = f.search.trim().toLowerCase();
  return leads.filter((l) => {
    if (!matchesView(l, f.view, ctx.now)) return false;
    if (f.stage !== "any" && l.pipeline_stage_id !== f.stage) return false;
    if (f.owner === "unassigned" && l.assigned_to) return false;
    if (f.owner === "me" && (!ctx.userId || l.assigned_to !== ctx.userId)) return false;
    if (f.owner !== "any" && f.owner !== "me" && f.owner !== "unassigned" && l.assigned_to !== f.owner) return false;
    if (f.source !== "any" && l.source !== f.source) return false;
    if (q && ![l.contact_name, l.phone, l.email, l.human_reference, l.company_name].some((v) => (v || "").toLowerCase().includes(q))) return false;
    return true;
  });
}

export function sortLeads(leads: LeadRow[], sort: LeadSort): LeadRow[] {
  const copy = [...leads];
  const time = (iso: string | null) => (iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY);
  switch (sort) {
    case "updated":
      return copy.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    case "newest":
      return copy.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    case "value":
      return copy.sort((a, b) => (Number(b.estimated_value) || -1) - (Number(a.estimated_value) || -1));
    case "follow_up":
      // Soonest (most overdue first); leads without a follow-up last.
      return copy.sort((a, b) => time(a.next_follow_up_at) - time(b.next_follow_up_at));
  }
}

export type LeadSummary = { open: number; unassigned: number; overdue: number; dueToday: number; qualified: number; converted: number };

export function summarizeLeads(leads: LeadRow[], now: Date): LeadSummary {
  const s: LeadSummary = { open: 0, unassigned: 0, overdue: 0, dueToday: 0, qualified: 0, converted: 0 };
  for (const l of leads) {
    if (l.archived_at) continue;
    if (l.status === "converted") s.converted += 1;
    if (l.status !== "active") continue;
    s.open += 1;
    if (!l.assigned_to) s.unassigned += 1;
    if (l.qualification_status === "qualified") s.qualified += 1;
    const fu = followUpState(l, now).kind;
    if (fu === "overdue") s.overdue += 1;
    if (fu === "due_today") s.dueToday += 1;
  }
  return s;
}

export function leadSources(leads: LeadRow[]): string[] {
  return [...new Set(leads.map((l) => l.source).filter(Boolean))].sort();
}

const SOURCE_LABEL: Record<string, string> = { whatsapp: "WhatsApp", facebook_lead_ad: "Facebook lead ad", instagram: "Instagram", facebook: "Facebook", website: "Website", manual: "Manual", referral: "Referral" };

export function sourceLabel(source: string): string {
  if (SOURCE_LABEL[source]) return SOURCE_LABEL[source];
  const s = source.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
