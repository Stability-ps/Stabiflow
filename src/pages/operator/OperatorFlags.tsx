import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { operatorAdmin, type AdminFlag, type AdminFlagTarget } from "@/lib/operatorAdmin";

const AUDIENCE_LABELS = { everyone: "Everyone", operators: "Admins only", targeted: "Selected plans / rollout" } as const;

function FlagEditor({ flag, targets, onChanged }: { flag: AdminFlag; targets: AdminFlagTarget[]; onChanged: () => void }) {
  const [enabled, setEnabled] = useState(flag.is_enabled);
  const [audience, setAudience] = useState(flag.audience);
  const [plans, setPlans] = useState(flag.plan_codes.join(", "));
  const [rollout, setRollout] = useState(String(flag.rollout_percentage));
  const [reason, setReason] = useState("");
  const [showTargets, setShowTargets] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      operatorAdmin("update_flag", {
        flag_key: flag.key,
        reason,
        update: {
          is_enabled: enabled,
          audience,
          plan_codes: plans.split(",").map((p) => p.trim()).filter(Boolean),
          rollout_percentage: Number(rollout),
        },
      }),
    onSuccess: () => {
      toast.success("Flag saved");
      setReason("");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const id = (s: string) => `flag-${flag.key}-${s}`;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {flag.name} <Badge variant="outline" className="font-mono">{flag.key}</Badge>
          {!flag.is_enabled && <Badge variant="destructive">killed</Badge>}
          <Badge variant="secondary">{AUDIENCE_LABELS[flag.audience]}</Badge>
        </CardTitle>
        {flag.description && <p className="text-xs text-muted-foreground">{flag.description}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="flex items-center gap-2">
            <Checkbox id={id("on")} checked={enabled} onCheckedChange={(v) => setEnabled(!!v)} />
            <Label htmlFor={id("on")}>Enabled (kill switch)</Label>
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("aud")}>Who</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as AdminFlag["audience"])}>
              <SelectTrigger id={id("aud")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AUDIENCE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("plans")}>Plans (codes)</Label>
            <Input id={id("plans")} value={plans} onChange={(e) => setPlans(e.target.value)} placeholder="business, growth" disabled={audience !== "targeted"} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("pct")}>Staged rollout %</Label>
            <Input id={id("pct")} type="number" min={0} max={100} value={rollout} onChange={(e) => setRollout(e.target.value)} disabled={audience !== "targeted"} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-sm" placeholder="Reason (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" onClick={() => save.mutate()} disabled={reason.trim().length < 3 || save.isPending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowTargets((v) => !v)}>
            {targets.length} workspace override{targets.length === 1 ? "" : "s"}
          </Button>
        </div>
        {showTargets && (
          <div className="max-h-48 space-y-0.5 overflow-auto text-xs text-muted-foreground">
            {targets.length === 0 && <p>None. Turn a module on or off for one workspace from the Workspaces tab.</p>}
            {targets.map((t) => (
              <p key={t.workspace_id}>
                {t.workspaces?.name ?? t.workspace_id} · {t.enabled ? "on" : "off"} · {t.reason}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function OperatorFlags() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["op-flags"], queryFn: () => operatorAdmin<{ flags: AdminFlag[]; targets: AdminFlagTarget[] }>("list_flags") });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (q.error || !q.data) return <p className="text-sm text-destructive">Could not load flags.</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Evaluation order: kill switch → platform admins (always see enabled flags) → per-workspace override → audience (everyone / admins only / selected plans or staged rollout).
        Flags only hide or show modules - they never delete data.
      </p>
      {q.data.flags.map((f) => (
        <FlagEditor key={f.key} flag={f} targets={q.data.targets.filter((t) => t.flag_key === f.key)} onChanged={() => qc.invalidateQueries({ queryKey: ["op-flags"] })} />
      ))}
    </div>
  );
}
