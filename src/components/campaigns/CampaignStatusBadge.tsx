import { Badge } from "@/components/ui/badge";

// Local StabiFlow workflow status (Phase 6 instruction #8), NOT Meta's own
// provider_effective_status - the two are tracked separately and may
// disagree (see ad_campaigns schema migration).
const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  publishing: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  completed: "bg-muted text-muted-foreground",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function CampaignStatusBadge({ status }: { status: string }) {
  return (
    <Badge className={STATUS_STYLE[status] || ""} variant="secondary">
      {status}
    </Badge>
  );
}
