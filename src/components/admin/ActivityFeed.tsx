import { Link } from "react-router-dom";
import { Building2, CircleDollarSign, CreditCard, Plug, UserPlus, Workflow, XCircle, Target, type LucideIcon } from "lucide-react";
import type { ActivityRow } from "@/lib/adminApi";
import { humanize, timeAgo } from "@/lib/adminFormat";

const KINDS: Record<string, { icon: LucideIcon; text: (r: ActivityRow) => string }> = {
  user_signed_up: { icon: UserPlus, text: (r) => (r.label ? `${r.label} signed up` : "New user signed up") },
  workspace_created: { icon: Building2, text: (r) => `Business created: ${r.label}` },
  payment_succeeded: { icon: CircleDollarSign, text: (r) => `Payment received · ${r.label}` },
  payment_failed: { icon: XCircle, text: (r) => `Payment failed · ${r.label}` },
  payment_reversed: { icon: XCircle, text: (r) => `Payment reversed · ${r.label}` },
  payment_amount_mismatch: { icon: XCircle, text: (r) => `Payment amount mismatch · ${r.label}` },
  automation_failed: { icon: Workflow, text: (r) => `Automation failed: ${r.label}` },
  integration_connected: { icon: Plug, text: (r) => `${r.label === "meta" ? "Meta" : r.label === "whatsapp" ? "WhatsApp" : r.label} connected` },
  lead_created: { icon: Target, text: (r) => `Lead created${r.label ? ` (${humanize(r.label)})` : ""}` },
};

export function ActivityFeed({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No activity recorded yet.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => {
        const k = KINDS[r.kind] ?? (r.kind.startsWith("subscription_")
          ? { icon: CreditCard, text: (x: ActivityRow) => `Subscription ${x.label}` }
          : { icon: CircleDollarSign, text: (x: ActivityRow) => humanize(x.kind) });
        return (
          <li key={`${r.kind}-${r.at}-${i}`} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted"><k.icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate">{k.text(r)}</p>
              <p className="text-xs text-muted-foreground">
                {r.workspace_id && r.kind !== "workspace_created" ? <><Link className="hover:underline" to={`/admin/businesses/${r.workspace_id}`}>{r.workspace_name ?? "Business"}</Link> · </> : null}
                {r.kind === "workspace_created" && r.workspace_id ? <><Link className="hover:underline" to={`/admin/businesses/${r.workspace_id}`}>Open</Link> · </> : null}
                {r.kind === "user_signed_up" && r.user_id ? <><Link className="hover:underline" to={`/admin/users/${r.user_id}`}>Open</Link> · </> : null}
                {timeAgo(r.at)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
