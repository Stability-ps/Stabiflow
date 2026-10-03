import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { operatorAdmin } from "@/lib/operatorAdmin";

type SystemStatus = {
  secrets: { name: string; area: string; required: boolean; configured: boolean }[];
  paystackMode: "live" | "test" | "not_configured";
  failedJobs: {
    automationRuns: { id: string; workspace_id: string; error: unknown; created_at: string }[];
    contentPosts: { id: string; workspace_id: string; updated_at: string }[];
    billingWebhooks: { id: string; event_type: string; processing_result: string | null; received_at: string }[];
  };
  whatsappWebhookEvents7d: number;
};
type AuditRow = { id: string; action: string; target_type?: string; target_id?: string | null; workspace_id: string | null; reason: string | null; created_at: string; profiles: { full_name: string | null } | null };

/** Integrations (secret configured/missing only), failed jobs and audit log. */
export function OperatorSystem() {
  const status = useQuery({ queryKey: ["op-system"], queryFn: () => operatorAdmin<SystemStatus>("system_status") });
  const audit = useQuery({ queryKey: ["op-audit"], queryFn: () => operatorAdmin<{ admin: AuditRow[]; workspaceActions: AuditRow[] }>("audit_log") });
  const s = status.data;
  const failedCount = s ? s.failedJobs.automationRuns.length + s.failedJobs.contentPosts.length + s.failedJobs.billingWebhooks.length : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Integrations and credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">Only whether each credential is configured is shown. Values are never displayed; change them in the Supabase edge-function secrets.</p>
          {s && (
            <p>
              Paystack mode: <Badge variant={s.paystackMode === "live" ? "default" : "outline"}>{s.paystackMode.replace("_", " ")}</Badge>
            </p>
          )}
          <div className="grid gap-1 sm:grid-cols-2">
            {(s?.secrets ?? []).map((x) => (
              <div key={x.name} className="flex items-center gap-2 rounded border px-2 py-1">
                {x.configured ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Configured" /> : <XCircle className={`h-4 w-4 ${x.required ? "text-destructive" : "text-muted-foreground"}`} aria-label="Missing" />}
                <span className="font-mono text-xs">{x.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{x.area}{x.required ? " · required" : ""}</span>
              </div>
            ))}
          </div>
          {s && <p className="text-xs text-muted-foreground">WhatsApp webhook events received in the last 7 days: {s.whatsappWebhookEvents7d}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Failed jobs (last 7 days){s ? ` · ${failedCount}` : ""}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          {s && failedCount === 0 && <p className="text-muted-foreground">No failures.</p>}
          {s?.failedJobs.billingWebhooks.map((w) => <p key={w.id}>Payment webhook {w.event_type} · {new Date(w.received_at).toLocaleString()} · {w.processing_result}</p>)}
          {s?.failedJobs.automationRuns.map((r) => <p key={r.id}>Automation run · workspace {r.workspace_id.slice(0, 8)} · {new Date(r.created_at).toLocaleString()}</p>)}
          {s?.failedJobs.contentPosts.map((p) => <p key={p.id}>Content post · workspace {p.workspace_id.slice(0, 8)} · {new Date(p.updated_at).toLocaleString()}</p>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          {[...(audit.data?.admin ?? []), ...(audit.data?.workspaceActions ?? [])]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 100)
            .map((r) => (
              <p key={r.id}>
                <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span> · {r.profiles?.full_name ?? "operator"} · <span className="font-medium">{r.action}</span>
                {r.target_type ? ` · ${r.target_type}${r.target_id ? ` ${r.target_id}` : ""}` : ""}
                {r.workspace_id ? ` · workspace ${r.workspace_id.slice(0, 8)}` : ""}
                {r.reason ? ` · "${r.reason}"` : ""}
              </p>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
