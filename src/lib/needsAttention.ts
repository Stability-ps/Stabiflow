// Pure logic for the Needs Attention action layer. The data itself is
// composed client-side from existing, RLS-protected tables (see
// src/hooks/useNeedsAttention.ts) - this file only types, orders and
// presents it. No I/O.

export type NeedsAttentionSeverity = "critical" | "warning" | "info";

export type NeedsAttentionKind =
  | "human_takeover"
  | "customer_reply"
  | "priority_conversation"
  | "message_failed"
  | "handoff_sla_overdue"
  | "ai_usage_limit_reached"
  | "campaign_failed"
  | "integration_unhealthy"
  | "automation_failed"
  | "lead_unowned";

export type NeedsAttentionItem = {
  /** stable + unique per render - the underlying alert/row id, never a
   *  synthesised "type:targetId" that can collide across rows. */
  id: string;
  kind: NeedsAttentionKind;
  severity: NeedsAttentionSeverity;
  title: string;
  description: string;
  /** ISO timestamp of the underlying event, or null when genuinely unknown
   *  (never a synthesised "now" - audit M14). */
  occurredAt: string | null;
  targetType: "conversation" | "campaign" | "integration" | "automation" | "lead";
  targetId: string;
  actionPath: string;
  /** the verb shown when the viewer may actually perform the action */
  actionLabel: string;
  /** true when the viewer holds the permission the action requires; when
   *  false the item still shows, but as a plain "View" link (audit M12). */
  canAct: boolean;
};

const SEVERITY_RANK: Record<NeedsAttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Most urgent first: severity, then most recent (null timestamps last). */
export function sortNeedsAttention(items: NeedsAttentionItem[]): NeedsAttentionItem[] {
  return [...items].sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    const at = a.occurredAt ? new Date(a.occurredAt).getTime() : -Infinity;
    const bt = b.occurredAt ? new Date(b.occurredAt).getTime() : -Infinity;
    return bt - at;
  });
}

/** De-duplicate by id, keeping the most recent occurrence (audit M9). */
export function dedupeNeedsAttention(items: NeedsAttentionItem[]): NeedsAttentionItem[] {
  const byId = new Map<string, NeedsAttentionItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const a = item.occurredAt ? new Date(item.occurredAt).getTime() : -Infinity;
    const b = existing.occurredAt ? new Date(existing.occurredAt).getTime() : -Infinity;
    if (a > b) byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function severityTone(severity: NeedsAttentionSeverity): string {
  switch (severity) {
    case "critical":
      return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
    case "warning":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function relativeTimeShort(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return "";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** A summary line for a collapsed panel: "3 need attention · 1 critical". */
export function summarize(items: NeedsAttentionItem[]): string {
  if (items.length === 0) return "Nothing needs attention";
  const critical = items.filter((i) => i.severity === "critical").length;
  const base = `${items.length} ${items.length === 1 ? "item needs" : "items need"} attention`;
  return critical > 0 ? `${base} · ${critical} critical` : base;
}
