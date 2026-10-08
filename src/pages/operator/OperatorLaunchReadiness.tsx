import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { operatorAdmin } from "@/lib/operatorAdmin";
import { ErrorState } from "@/components/admin/AdminPrimitives";

type Check = { key: string; label: string; status: "pass" | "warn" | "fail"; detail: string };
type LaunchReadiness = {
  checks: Check[];
  summary: { pass: number; warn: number; fail: number };
  plans: Array<{ code: string; name: string; is_public: boolean; is_active: boolean; prices: number; purchasable_prices: number }>;
  billing: { paystack_mode: "live" | "test" | "not_configured"; failed_webhooks_7d: number; amount_mismatches: number; pending_checkouts: number };
  mobile: { manifest: boolean; service_worker: boolean; installable_shell: boolean };
  deferred?: string[];
};

function Icon({ status }: { status: Check["status"] }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-success" aria-label="Pass" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-warning" aria-label="Warning" />;
  return <XCircle className="h-4 w-4 text-destructive" aria-label="Fail" />;
}

export function OperatorLaunchReadiness() {
  const q = useQuery({ queryKey: ["operator-launch-readiness"], queryFn: () => operatorAdmin<LaunchReadiness>("launch_readiness") });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Checking launch readiness...</p>;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data;
  const certified = data.summary.fail === 0;

  return (
    <div className="space-y-4">
      <Card className={certified ? "border-success/30 bg-success-soft" : "border-destructive/30 bg-destructive/5"}>
        <CardContent className="flex items-center gap-3 pt-6">
          {certified ? <CheckCircle2 className="h-5 w-5 text-success" /> : <XCircle className="h-5 w-5 text-destructive" />}
          <div><p className="font-medium">{certified ? "Pre-payment launch certification passed" : "Launch blockers still need attention"}</p><p className="text-xs text-muted-foreground">{certified ? "All non-deferred production checks are passing. Live Paystack certification can be completed later." : "Clear the failed checks below before launch."}</p></div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardHeader className="pb-1"><CardTitle className="text-label font-normal text-muted-foreground">Passed</CardTitle></CardHeader><CardContent><p className="text-metric tabular-nums text-success">{data.summary.pass}</p></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-label font-normal text-muted-foreground">Warnings</CardTitle></CardHeader><CardContent><p className="text-metric tabular-nums text-warning">{data.summary.warn}</p></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-label font-normal text-muted-foreground">Blockers</CardTitle></CardHeader><CardContent><p className="text-metric tabular-nums text-destructive-strong">{data.summary.fail}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Production checklist</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {data.checks.map((c) => (
            <div key={c.key} className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <Icon status={c.status} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.label}</p>
                <p className="text-xs text-muted-foreground">{c.detail}</p>
              </div>
              <Badge variant={c.status === "fail" ? "destructive" : "outline"}>{c.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {data.deferred && data.deferred.length > 0 && (
        <Card className="border-warning/30 bg-warning-soft">
          <CardHeader><CardTitle className="text-base">Deferred until payment credentials are ready</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">{data.deferred.map((x) => <p key={x}>• {x}</p>)}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Commercial plans</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {data.plans.map((p) => (
            <div key={p.code} className="rounded-md border p-3 text-sm">
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.code}</p>
              <p className="mt-2 text-xs">{p.purchasable_prices}/{p.prices} configured prices purchasable</p>
              <p className="text-xs text-muted-foreground">{p.is_public ? "Public" : "Hidden"} · {p.is_active ? "Active" : "Inactive"}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Billing and installability</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="font-medium">Paystack</p>
            <p className="text-muted-foreground">Mode: {data.billing.paystack_mode.replace("_", " ")}</p>
            <p className="text-xs text-muted-foreground">Failed webhooks 7d: {data.billing.failed_webhooks_7d} · Amount mismatches: {data.billing.amount_mismatches} · Pending checkouts: {data.billing.pending_checkouts}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="font-medium">PWA shell</p>
            <p className="flex items-center gap-2 text-muted-foreground">{data.mobile.installable_shell ? <CheckCircle2 className="h-4 w-4 text-success" /> : <CircleDashed className="h-4 w-4" />} Installable shell configured</p>
            <p className="text-xs text-muted-foreground">Manifest: {data.mobile.manifest ? "yes" : "no"} · Service worker: {data.mobile.service_worker ? "yes" : "no"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
