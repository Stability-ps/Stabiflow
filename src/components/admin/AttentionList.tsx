import { Link } from "react-router-dom";
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleAlert, Info, type LucideIcon } from "lucide-react";
import type { AdminAlert } from "@/lib/adminApi";
import { timeAgo } from "@/lib/adminFormat";
import { cn } from "@/lib/utils";

// Status colour always ships with an icon and a text label.
const SEVERITY: Record<AdminAlert["severity"], { label: string; icon: LucideIcon; className: string }> = {
  critical: { label: "Critical", icon: AlertOctagon, className: "text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950/40 dark:border-red-900" },
  high: { label: "High", icon: AlertTriangle, className: "text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-300 dark:bg-orange-950/40 dark:border-orange-900" },
  medium: { label: "Medium", icon: CircleAlert, className: "text-amber-800 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-900" },
  low: { label: "Low", icon: Info, className: "text-slate-700 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-slate-900/60 dark:border-slate-800" },
};

export function SeverityBadge({ severity }: { severity: AdminAlert["severity"] }) {
  const s = SEVERITY[severity];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 self-start rounded-full border px-2 py-0.5 text-[11px] font-medium", s.className)}>
      <s.icon className="h-3 w-3" aria-hidden="true" />{s.label}
    </span>
  );
}

export function AttentionList({ alerts, limit }: { alerts: AdminAlert[]; limit?: number }) {
  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-sm text-muted-foreground justify-center">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        Nothing needs attention right now. Payments, webhooks, automations, integrations and AI are within normal limits.
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {alerts.slice(0, limit ?? alerts.length).map((a) => (
        <li key={a.id}>
          <Link to={a.href} className="flex flex-col gap-1 py-3 hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-start sm:gap-3 sm:px-2 -mx-2 px-2 rounded-md">
            <SeverityBadge severity={a.severity} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{a.title}</p>
              <p className="text-xs text-muted-foreground">
                {a.workspace?.name ? <span className="font-medium text-foreground/80">{a.workspace.name} · </span> : null}
                {a.detail}
              </p>
            </div>
            {a.at ? <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.at)}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
