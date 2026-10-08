import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { operatorAdmin } from "@/lib/operatorAdmin";
import { ErrorState } from "@/components/admin/AdminPrimitives";

type Ent = { entitlement_key: string; kind: string; enabled: boolean; limit_value: number | null; unlimited: boolean; used: number; source: string };
type Flag = { flag_key: string; enabled: boolean; reason: string };
type Override = { id: string; entitlement_key: string; bool_value: boolean | null; limit_value: number | null; reason: string; expires_at: string | null };
type Commercial = {
  entitlements: Ent[];
  flags: Flag[];
  subscriptions: { id: string; status: string; current_period_end: string | null; billing_plans: { name: string } | null }[];
  purchases: { id: string; status: string; paid_at: string | null; billing_plans: { name: string } | null }[];
  overrides: Override[];
  identity: { trading_name: string | null; legal_name: string | null; website: string | null; industry: string | null; verification_status: string } | null;
};

const entValue = (e: Ent) =>
  e.kind === "boolean" ? (e.enabled ? "on" : "off") : !e.enabled ? "off" : e.unlimited ? "unlimited" : `${e.kind === "allowance" ? `${e.used}/` : ""}${e.limit_value}`;

/** Per-workspace plan, entitlements, module flags and audited overrides. */
export function WorkspaceCommercialPanel({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const key = ["operator-commercial", workspaceId];
  const q = useQuery({ queryKey: key, queryFn: () => operatorAdmin<Commercial>("workspace_commercial", { workspace_id: workspaceId }) });
  const [reason, setReason] = useState("");
  const [overrideKey, setOverrideKey] = useState("");
  const [overrideMode, setOverrideMode] = useState<"grant" | "revoke" | "limit">("grant");
  const [overrideLimit, setOverrideLimit] = useState("");

  const onDone = (msg: string) => () => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: key });
  };
  const onError = (e: Error) => toast.error(e.message);

  const grant = useMutation({
    mutationFn: () =>
      operatorAdmin("grant_override", {
        reason,
        override: {
          workspace_id: workspaceId,
          entitlement_key: overrideKey,
          bool_value: overrideMode === "revoke" ? false : true,
          limit_value: overrideMode === "limit" ? (overrideLimit === "" ? null : Number(overrideLimit)) : null,
        },
      }),
    onSuccess: onDone("Override saved"),
    onError,
  });
  const revoke = useMutation({
    mutationFn: (k: string) => operatorAdmin("revoke_override", { workspace_id: workspaceId, entitlement_key: k, reason }),
    onSuccess: onDone("Override removed"),
    onError,
  });
  const target = useMutation({
    mutationFn: (v: { flag: string; enabled: boolean }) => operatorAdmin("set_flag_target", { flag_key: v.flag, workspace_id: workspaceId, enabled: v.enabled, reason }),
    onSuccess: onDone("Module access updated"),
    onError,
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading commercial state...</p>;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const needsReason = reason.trim().length < 3;

  return (
    <div className="space-y-4 rounded-md border p-4">
      <h3 className="font-semibold">Business, plan and access</h3>
      {d.identity && (
        <p className="text-sm text-muted-foreground">
          {d.identity.trading_name ?? d.identity.legal_name ?? "Unnamed business"}
          {d.identity.website ? ` · ${d.identity.website}` : ""}
          {d.identity.industry ? ` · ${d.identity.industry}` : ""} · {d.identity.verification_status}
        </p>
      )}
      <div className="text-sm">
        <p className="font-medium">Subscriptions</p>
        {d.subscriptions.length === 0 && <p className="text-muted-foreground">None</p>}
        {d.subscriptions.map((s) => (
          <p key={s.id} className="text-muted-foreground">
            {s.billing_plans?.name} · {s.status}
            {s.current_period_end ? ` · until ${new Date(s.current_period_end).toLocaleDateString()}` : ""}
          </p>
        ))}
        {d.purchases.map((p) => (
          <p key={p.id} className="text-muted-foreground">
            {p.billing_plans?.name} (once-off) · {p.status}
          </p>
        ))}
      </div>

      <Input placeholder="Reason for any change below (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} />

      <div>
        <p className="mb-1 text-sm font-medium">Entitlements</p>
        <div className="flex flex-wrap gap-1">
          {d.entitlements.map((e) => (
            <Badge key={e.entitlement_key} variant={e.enabled ? "default" : "outline"} title={`source: ${e.source}`}>
              {e.entitlement_key}: {entValue(e)}
              {e.source === "override" ? " *" : ""}
            </Badge>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={overrideKey} onValueChange={setOverrideKey}>
            <SelectTrigger className="w-60" aria-label="Entitlement to override">
              <SelectValue placeholder="Entitlement..." />
            </SelectTrigger>
            <SelectContent>
              {d.entitlements.map((e) => (
                <SelectItem key={e.entitlement_key} value={e.entitlement_key}>
                  {e.entitlement_key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={overrideMode} onValueChange={(v) => setOverrideMode(v as typeof overrideMode)}>
            <SelectTrigger className="w-36" aria-label="Override type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grant">Grant</SelectItem>
              <SelectItem value="revoke">Revoke</SelectItem>
              <SelectItem value="limit">Set limit</SelectItem>
            </SelectContent>
          </Select>
          {overrideMode === "limit" && (
            <Input className="w-32" type="number" min={0} placeholder="blank = unlimited" value={overrideLimit} onChange={(e) => setOverrideLimit(e.target.value)} aria-label="Limit" />
          )}
          <Button size="sm" onClick={() => grant.mutate()} disabled={!overrideKey || needsReason || grant.isPending}>
            Save override
          </Button>
        </div>
        {d.overrides.map((o) => (
          <div key={o.id} className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {o.entitlement_key} → {o.bool_value === false ? "revoked" : o.limit_value !== null ? `limit ${o.limit_value}` : "granted"} ({o.reason})
            </span>
            <Button size="sm" variant="ghost" className="h-6" onClick={() => revoke.mutate(o.entitlement_key)} disabled={needsReason}>
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div>
        <p className="mb-1 text-sm font-medium">Modules (feature flags)</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {d.flags.map((f) => (
            <div key={f.flag_key} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
              <span>
                {f.flag_key} · <span className={f.enabled ? "text-success" : "text-muted-foreground"}>{f.enabled ? "on" : "off"}</span> ({f.reason})
              </span>
              <Button size="sm" variant="ghost" className="h-6" disabled={needsReason || target.isPending} onClick={() => target.mutate({ flag: f.flag_key, enabled: !f.enabled })}>
                {f.enabled ? "Turn off" : "Turn on"}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
