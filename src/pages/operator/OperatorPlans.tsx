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
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, intervalLabel } from "@/lib/billing";
import { operatorAdmin, type AdminPlan, type AdminPrice, type EntitlementDefinition } from "@/lib/operatorAdmin";

type Catalog = { plans: AdminPlan[]; definitions: EntitlementDefinition[] };

function PlanEditor({ plan, definitions, onChanged }: { plan: AdminPlan; definitions: EntitlementDefinition[]; onChanged: () => void }) {
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? "");
  const [features, setFeatures] = useState((plan.marketing.features ?? []).join("\n"));
  const [cta, setCta] = useState(plan.marketing.cta ?? "");
  const [badge, setBadge] = useState(plan.marketing.badge ?? "");
  const [isPublic, setIsPublic] = useState(plan.is_public);
  const [isActive, setIsActive] = useState(plan.is_active);
  const [newAmount, setNewAmount] = useState("");
  const [newInterval, setNewInterval] = useState<AdminPrice["billing_interval"]>(plan.plan_kind === "subscription" ? "month" : "once");
  const onError = (e: Error) => toast.error(e.message);
  const done = (msg: string) => () => {
    toast.success(msg);
    onChanged();
  };

  const savePlan = useMutation({
    mutationFn: () =>
      operatorAdmin("upsert_plan", {
        plan: {
          code: plan.code, name, description, plan_kind: plan.plan_kind, tier_rank: plan.tier_rank, sort_order: plan.sort_order,
          is_public: isPublic, is_active: isActive,
          marketing: { features: features.split("\n").map((f) => f.trim()).filter(Boolean), cta: cta || null, badge: badge || null },
        },
      }),
    onSuccess: done("Plan saved"),
    onError,
  });

  const addPrice = useMutation({
    mutationFn: () => {
      const rand = Number(newAmount.replace(",", "."));
      if (!Number.isFinite(rand) || rand < 0) throw new Error("Enter the price in Rand, e.g. 249 or 249.99");
      return operatorAdmin("create_price", { price: { plan_id: plan.id, amount_minor: Math.round(rand * 100), billing_interval: newInterval, currency: "ZAR" } });
    },
    onSuccess: () => {
      setNewAmount("");
      done("Price created - remember to deactivate the old one")();
    },
    onError,
  });

  const updatePrice = useMutation({
    mutationFn: (v: { id: string; update: Record<string, unknown> }) => operatorAdmin("update_price", { price_id: v.id, update: v.update }),
    onSuccess: done("Price updated"),
    onError,
  });

  const setEnt = useMutation({
    mutationFn: (v: { key: string; bool_value: boolean | null; limit_value: number | null }) =>
      operatorAdmin("set_plan_entitlement", { entitlement: { plan_id: plan.id, entitlement_key: v.key, bool_value: v.bool_value, limit_value: v.limit_value } }),
    onSuccess: done("Entitlement saved"),
    onError,
  });
  const removeEnt = useMutation({
    mutationFn: (key: string) => operatorAdmin("remove_plan_entitlement", { plan_id: plan.id, entitlement_key: key }),
    onSuccess: done("Entitlement removed"),
    onError,
  });

  const id = (s: string) => `plan-${plan.code}-${s}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {plan.name} <Badge variant="outline">{plan.code}</Badge> <Badge variant="secondary">{plan.plan_kind.replace("_", "-")}</Badge>
          {!plan.is_active && <Badge variant="destructive">inactive</Badge>}
          {!plan.is_public && <Badge variant="outline">hidden</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={id("name")}>Name</Label>
            <Input id={id("name")} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("badge")}>Badge</Label>
            <Input id={id("badge")} value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="e.g. Most popular" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={id("desc")}>Description</Label>
            <Input id={id("desc")} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("features")}>Benefits (one per line)</Label>
            <Textarea id={id("features")} value={features} onChange={(e) => setFeatures(e.target.value)} rows={4} />
          </div>
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor={id("cta")}>Button label</Label>
              <Input id={id("cta")} value={cta} onChange={(e) => setCta(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id={id("public")} checked={isPublic} onCheckedChange={(v) => setIsPublic(!!v)} />
              <Label htmlFor={id("public")}>Shown on pricing</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id={id("active")} checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
              <Label htmlFor={id("active")}>Active</Label>
            </div>
          </div>
        </div>
        <Button size="sm" onClick={() => savePlan.mutate()} disabled={savePlan.isPending}>
          Save plan
        </Button>

        {plan.plan_kind !== "free" && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Prices</p>
            <p className="text-xs text-muted-foreground">Prices can't be edited once created (existing subscribers keep what they agreed to). To change a price, add a new one and deactivate the old one.</p>
            {plan.billing_prices.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className={p.is_active ? "font-medium" : "text-muted-foreground line-through"}>
                  {formatMoney(p.amount_minor, p.currency)} {intervalLabel(p.billing_interval)}
                </span>
                {p.billing_interval !== "once" && (
                  <Input
                    className="h-8 w-44 font-mono text-xs"
                    defaultValue={p.paystack_plan_code ?? ""}
                    placeholder="Paystack PLN_..."
                    aria-label="Paystack plan code"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (p.paystack_plan_code ?? "")) updatePrice.mutate({ id: p.id, update: { paystack_plan_code: v || null } });
                    }}
                  />
                )}
                {p.billing_interval !== "once" && !p.paystack_plan_code && <Badge variant="destructive">not purchasable</Badge>}
                <Button size="sm" variant="ghost" onClick={() => updatePrice.mutate({ id: p.id, update: { is_active: !p.is_active } })}>
                  {p.is_active ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-8 w-32" inputMode="decimal" placeholder="Rand" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} aria-label="New price in Rand" />
              <Select value={newInterval} onValueChange={(v) => setNewInterval(v as AdminPrice["billing_interval"])}>
                <SelectTrigger className="h-8 w-36" aria-label="Billing interval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plan.plan_kind === "subscription" ? (
                    <>
                      <SelectItem value="month">Monthly</SelectItem>
                      <SelectItem value="year">Annual</SelectItem>
                    </>
                  ) : (
                    <SelectItem value="once">Once-off</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => addPrice.mutate()} disabled={!newAmount || addPrice.isPending}>
                Add price
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">What this plan includes</p>
          <div className="grid gap-1">
            {definitions.map((def) => {
              const cur = plan.plan_entitlements.find((e) => e.entitlement_key === def.key);
              return (
                <div key={def.key} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-56">{def.name}</span>
                  {def.kind === "boolean" ? (
                    <Checkbox
                      checked={cur?.bool_value === true}
                      aria-label={`${def.name} included`}
                      onCheckedChange={(v) => (v ? setEnt.mutate({ key: def.key, bool_value: true, limit_value: null }) : cur && removeEnt.mutate(def.key))}
                    />
                  ) : (
                    <>
                      <Input
                        className="h-8 w-28"
                        type="number"
                        min={0}
                        defaultValue={cur ? (cur.limit_value ?? "") : ""}
                        placeholder={cur ? "unlimited" : "not included"}
                        aria-label={`${def.name} limit`}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const next = raw === "" ? null : Number(raw);
                          if (cur && next === cur.limit_value) return;
                          if (!cur && raw === "") return;
                          setEnt.mutate({ key: def.key, bool_value: null, limit_value: next });
                        }}
                      />
                      <span className="text-xs text-muted-foreground">{def.unit}{def.kind === "allowance" ? " / month" : ""}</span>
                      {cur && (
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => removeEnt.mutate(def.key)}>
                          Remove
                        </Button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function OperatorPlans() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["op-catalog"], queryFn: () => operatorAdmin<Catalog>("list_catalog") });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (q.error || !q.data) return <p className="text-sm text-destructive">Could not load plans.</p>;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["op-catalog"] });
    qc.invalidateQueries({ queryKey: ["billing-catalog"] });
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Changes apply immediately to the public pricing page and to every workspace's entitlements. Every change is audited.</p>
      {q.data.plans.map((p) => (
        <PlanEditor key={p.id} plan={p} definitions={q.data.definitions} onChanged={refresh} />
      ))}
    </div>
  );
}
