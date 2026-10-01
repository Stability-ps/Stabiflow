import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  annualSavingPercent, cancelSubscription, fetchBillingState, fetchCatalog, fetchEntitlements, formatMoney, intervalLabel, isOurReference,
  startCheckout, verifyPayment, type BillingInterval, type CatalogPlan,
} from "@/lib/billing";

const VERIFY_ATTEMPTS = 6;
const VERIFY_DELAY_MS = 3000;
const PENDING_CHECKOUT_KEY = "stabiflow.pendingCheckout";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  past_due: "Payment failed - retrying",
  grace: "Payment overdue",
  cancelled: "Cancelled - ends at period end",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }) : "-";
}

function planTheme(code: string) {
  if (code === "business") return {
    card: "border-sky-200 bg-gradient-to-b from-sky-50/90 to-background shadow-sm",
    badge: "bg-sky-100 text-sky-800 hover:bg-sky-100",
    button: "bg-sky-600 text-white hover:bg-sky-700",
    check: "text-sky-600",
  };
  if (code === "growth") return {
    card: "border-violet-200 bg-gradient-to-b from-violet-50/90 to-background shadow-sm",
    badge: "bg-violet-100 text-violet-800 hover:bg-violet-100",
    button: "bg-violet-600 text-white hover:bg-violet-700",
    check: "text-violet-600",
  };
  return {
    card: "border-amber-200 bg-gradient-to-b from-amber-50/90 to-background shadow-sm",
    badge: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    button: "bg-amber-500 text-slate-950 hover:bg-amber-600",
    check: "text-amber-600",
  };
}

export default function Billing() {
  const { currentWorkspaceId, hasPermission } = useAuth();
  const canManage = hasPermission("manage_billing");
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [interval, setInterval] = useState<Exclude<BillingInterval, "once">>("month");
  const [verifying, setVerifying] = useState(false);
  const verifiedRef = useRef<string | null>(null);

  const catalog = useQuery({ queryKey: ["billing-catalog"], queryFn: fetchCatalog, staleTime: 5 * 60_000 });
  const state = useQuery({
    queryKey: ["billing-state", currentWorkspaceId],
    queryFn: () => fetchBillingState(currentWorkspaceId as string),
    enabled: !!currentWorkspaceId,
  });
  const entitlements = useQuery({
    queryKey: ["entitlements", currentWorkspaceId],
    queryFn: () => fetchEntitlements(currentWorkspaceId as string),
    enabled: !!currentWorkspaceId,
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["billing-state", currentWorkspaceId] });
    queryClient.invalidateQueries({ queryKey: ["entitlements", currentWorkspaceId] });
    queryClient.invalidateQueries({ queryKey: ["feature-flags", currentWorkspaceId] });
  };

  // Returning from Paystack: ask the SERVER to verify with Paystack. The
  // redirect itself grants nothing.
  useEffect(() => {
    const reference = searchParams.get("reference");
    if (!currentWorkspaceId || !isOurReference(reference) || verifiedRef.current === reference) return;
    verifiedRef.current = reference;
    let cancelled = false;
    setVerifying(true);
    (async () => {
      let status = "pending";
      for (let i = 0; i < VERIFY_ATTEMPTS && !cancelled; i++) {
        try {
          status = (await verifyPayment(currentWorkspaceId, reference)).status;
        } catch {
          status = "pending";
        }
        if (status !== "pending") break;
        await new Promise((r) => setTimeout(r, VERIFY_DELAY_MS));
      }
      if (cancelled) return;
      setVerifying(false);
      if (status === "success") toast.success("Payment confirmed - thank you!");
      else if (status === "failed") toast.error("The payment did not go through. You have not been charged.");
      else if (status === "needs_review") toast.warning("We received your payment but need to check it. Our team will be in touch.");
      else toast.info("Your payment is still being confirmed. This page will update once it clears.");
      refreshAll();
      const next = new URLSearchParams(searchParams);
      next.delete("reference");
      next.delete("trxref");
      next.delete("mock_checkout");
      setSearchParams(next, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspaceId, searchParams]);

  const checkout = useMutation({
    mutationFn: (priceId: string) => startCheckout(currentWorkspaceId as string, priceId),
    onSuccess: (res) => window.location.assign(res.authorization_url),
    onError: (e: Error) => toast.error(e.message),
  });

  // A visitor may choose a paid plan before signing in. Pricing stores only
  // the public price id; checkout still runs here, after auth/workspace checks.
  useEffect(() => {
    if (!currentWorkspaceId || !canManage || checkout.isPending || verifying) return;
    const raw = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!raw) return;
    try {
      const pending = JSON.parse(raw) as { priceId?: unknown };
      if (typeof pending.priceId !== "string" || !pending.priceId) {
        sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
        return;
      }
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
      checkout.mutate(pending.priceId);
    } catch {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
    }
    // Run when the authenticated workspace becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspaceId, canManage]);

  const cancel = useMutation({
    mutationFn: () => cancelSubscription(currentWorkspaceId as string),
    onSuccess: () => {
      toast.success("Subscription cancelled. You keep access until the end of the paid period.");
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentWorkspaceId) return null;

  const sub = state.data?.subscription ?? null;
  const purchases = state.data?.purchases ?? [];
  const highestPurchase = purchases.reduce<(typeof purchases)[number] | null>(
    (best, p) => !best || (p.plan?.tier_rank ?? 0) > (best.plan?.tier_rank ?? 0) ? p : best,
    null,
  );
  const plans = (catalog.data ?? []).filter((p) => p.plan_kind !== "free");
  const oneOff = plans.filter((p) => p.plan_kind === "one_off");
  const recurring = plans.filter((p) => p.plan_kind === "subscription");

  const planCard = (plan: CatalogPlan, priceInterval: BillingInterval) => {
    const price = plan.prices.find((p) => p.billing_interval === priceInterval);
    if (!price) return null;
    const isCurrent = !!sub && sub.plan?.code === plan.code && sub.status !== "cancelled";
    const purchase = plan.plan_kind === "one_off"
      ? purchases.find((p) => p.plan?.code === plan.code)
      : undefined;
    const isPurchased = !!purchase && (!purchase.access_expires_at || new Date(purchase.access_expires_at).getTime() > Date.now());
    const saving = priceInterval === "year" ? annualSavingPercent(plan.prices) : null;
    const theme = planTheme(plan.code);
    return (
      <Card key={`${plan.id}-${priceInterval}`} className={`flex flex-col overflow-hidden transition-shadow hover:shadow-md ${theme.card}`}>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">{plan.name}</CardTitle>
            {plan.marketing.badge && <Badge className={theme.badge}>{plan.marketing.badge}</Badge>}
          </div>
          <CardDescription>{plan.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <div>
            <span className="text-2xl font-semibold">{formatMoney(price.amount_minor, price.currency)}</span>
            <span className="ml-1 text-sm text-muted-foreground">{intervalLabel(price.billing_interval)}</span>
            {saving && <p className="text-xs text-emerald-700">Save {saving}% vs monthly</p>}
          </div>
          <ul className="flex-1 space-y-1 text-sm">
            {(plan.marketing.features ?? []).map((f) => (
              <li key={f} className="flex gap-2">
                <Check className={`mt-0.5 h-4 w-4 shrink-0 ${theme.check}`} aria-hidden="true" /> {f}
              </li>
            ))}
          </ul>
          {isPurchased ? (
            <div className="space-y-2">
              <Button disabled variant="outline" className="w-full border-emerald-200 bg-emerald-50 text-emerald-800 opacity-100">
                <Check className="mr-2 h-4 w-4" /> Purchased
              </Button>
              <p className="text-center text-xs text-muted-foreground">Bought {formatDate(purchase.paid_at)}</p>
            </div>
          ) : isCurrent ? (
            <Button disabled variant="outline">
              Current plan
            </Button>
          ) : (
            <Button
              className={theme.button}
              onClick={() => checkout.mutate(price.id)}
              disabled={!canManage || !price.purchasable || checkout.isPending || verifying}
              title={!canManage ? "Only the workspace owner can buy plans" : !price.purchasable ? "Not available yet" : undefined}
            >
              {checkout.isPending && checkout.variables === price.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {price.purchasable
                ? plan.plan_kind === "subscription"
                  ? `Upgrade to ${plan.name}`
                  : plan.marketing.cta ?? "Choose"
                : "Coming soon"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-sky-50 via-cyan-50 to-violet-50 p-5 sm:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Billing & plans</h1>
        <p className="mt-1 text-sm text-slate-600">Choose the plan that fits your business. Payments are processed securely by Paystack.</p>
      </div>

      {verifying && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6 text-sm" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Confirming your payment with Paystack...
          </CardContent>
        </Card>
      )}

      <Card className={sub ? "border-emerald-200 bg-gradient-to-r from-emerald-50/90 to-background shadow-sm" : "border-slate-200 bg-gradient-to-r from-slate-50 to-background shadow-sm"}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${sub ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                <CreditCard className="h-4 w-4" />
              </span>
              Current plan
            </CardTitle>
            {sub ? (
              <Badge className={sub.status === "active" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-amber-100 text-amber-800 hover:bg-amber-100"}>
                {STATUS_LABELS[sub.status] ?? sub.status}
              </Badge>
            ) : (
              <Badge variant="secondary">Free</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {state.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : sub ? (
            <>
              <div>
                <p className="text-xl font-semibold">{sub.plan?.name ?? "Subscription"}</p>
                {sub.price && <p className="mt-0.5 text-muted-foreground">{formatMoney(sub.price.amount_minor, sub.price.currency)} {intervalLabel(sub.price.billing_interval)}</p>}
              </div>
              {sub.status === "grace" && sub.grace_until && (
                <p className="text-amber-700">Your last payment did not go through. Access continues until {formatDate(sub.grace_until)} - please update your card with Paystack.</p>
              )}
              {sub.status === "past_due" && <p className="text-amber-700">Your last renewal failed. Paystack will retry the payment.</p>}
              <p className="text-muted-foreground">
                {sub.status === "cancelled" ? "Access ends" : "Next renewal"}: {formatDate(sub.current_period_end)}
              </p>
              {canManage && sub.status !== "cancelled" && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={cancel.isPending}>
                      Cancel subscription
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
                      <AlertDialogDescription>
                        You will not be charged again. You keep access until {formatDate(sub.current_period_end)}.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep subscription</AlertDialogCancel>
                      <AlertDialogAction onClick={() => cancel.mutate()}>Cancel subscription</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </>
          ) : highestPurchase ? (
            <div className="space-y-3">
              <div>
                <p className="text-xl font-semibold">{highestPurchase.plan?.name ?? "Purchased plan"}</p>
                <p className="mt-0.5 text-muted-foreground">
                  Purchased {formatDate(highestPurchase.paid_at)}
                  {highestPurchase.access_expires_at ? ` · access until ${formatDate(highestPurchase.access_expires_at)}` : " · yours permanently"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Current plan</Badge>
                {purchases.filter((p) => p.id !== highestPurchase.id).map((p) => (
                  <span key={p.id} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
                    {p.plan?.name ?? "Purchase"} · bought {formatDate(p.paid_at)}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xl font-semibold">Free</p>
              <p className="mt-0.5 text-muted-foreground">Start with the essentials, then upgrade when you are ready.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {!canManage && <p className="text-sm text-muted-foreground">Only the workspace owner can buy or change plans.</p>}

      {oneOff.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Once-off</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{oneOff.map((p) => planCard(p, "once"))}</div>
        </section>
      )}

      {recurring.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Subscriptions</h2>
            <div className="inline-flex rounded-full border bg-muted/40 p-1" role="group" aria-label="Billing interval">
              {(["month", "year"] as const).map((i) => (
                <Button key={i} size="sm" className="rounded-full" variant={interval === i ? "default" : "ghost"} onClick={() => setInterval(i)} aria-pressed={interval === i}>
                  {i === "month" ? "Monthly" : "Annual"}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{recurring.map((p) => planCard(p, interval))}</div>
        </section>
      )}

      <Card className="border-cyan-100 bg-cyan-50/30">
        <CardHeader>
          <CardTitle className="text-base">What your workspace includes</CardTitle>
          <CardDescription>Your current allowances and included tools at a glance.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {(entitlements.data ?? []).map((e) => (
              <li key={e.entitlement_key} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 ${e.enabled ? "border-emerald-100 bg-white" : "border-slate-200 bg-slate-50/70"}`}>
                <span>{e.entitlement_key.replace(/[._]/g, " ")}</span>
                <span className={e.enabled ? "font-medium text-emerald-700" : "text-muted-foreground"}>
                  {e.kind === "boolean"
                    ? e.enabled ? "Included" : "Not included"
                    : !e.enabled ? "Not included"
                    : e.unlimited ? "Unlimited"
                    : e.kind === "allowance" ? `${e.used} of ${e.limit_value} this month`
                    : `Up to ${e.limit_value}`}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {(state.data?.transactions ?? []).length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/30">
            <CardTitle className="text-base">Payment history</CardTitle>
            <CardDescription>Your most recent StabiFlow payments.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-4 font-normal">Date</th>
                  <th className="py-1 pr-4 font-normal">Amount</th>
                  <th className="py-1 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {state.data!.transactions.map((t) => (
                  <tr key={t.reference} className="border-t">
                    <td className="py-1 pr-4">{formatDate(t.paid_at ?? t.created_at)}</td>
                    <td className="py-1 pr-4">{formatMoney(t.amount_minor, t.currency)}</td>
                    <td className="py-1">{t.status === "initialized" ? "Not completed" : t.status.replace(/_/g, " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
