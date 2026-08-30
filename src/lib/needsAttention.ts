// Pure logic for the Needs Attention action layer. The data itself is
// composed client-side from existing, RLS-protected tables (see
// src/hooks/useNeedsAttention.ts) - this file only types, orders and
// presents it. No I/O.

export type NeedsAttentionSeverity = "critical" | "warning" | "info";

export type NeedsAttentionItem = {
  /** stable within a render - `${type}:${targetId}` */
  id: string;
  type:
    | "human_takeover"
    | "customer_reply"
    | "priority_conversation"
    | "message_failed"
    | "campaign_failed"
    | "integration_unhealthy"
    | "automation_failed"
    | "lead_unowned";
  severity: NeedsAttentionSeverity;
  title: string;
  description: string;
  /** ISO timestamp of the underlying event, for ordering + display */
  occurredAt: string;
  targetType: "conversation" | "campaign" | "integration" | "automation" | "lead";
  targetId: string;
  /** in-app path (may be extended with navigation state by the panel) */
  actionPath: string;
  actionLabel: string;
};

const SEVERITY_RANK: Record<NeedsAttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Most urgent first: severity, then most recent. */
export function sortNeedsAttention(items: NeedsAttentionItem[]): NeedsAttentionItem[] {
  return [...items].sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
  });
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

export function relativeTimeShort(iso: string): string {
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
