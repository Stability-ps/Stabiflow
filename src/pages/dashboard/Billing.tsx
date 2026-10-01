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
  const plans = (catalog.data ?? []).filter((p) => p.plan_kind !== "free");
  const oneOff = plans.filter((p) => p.plan_kind === "one_off");
  const recurring = plans.filter((p) => p.plan_kind === "subscription");

  const planCard = (plan: CatalogPlan, priceInterval: BillingInterval) => {
    const price = plan.prices.find((p) => p.billing_interval === priceInterval);
    if (!price) return null;
    const isCurrent = !!sub && sub.plan?.code === plan.code && sub.status !== "cancelled";
    const saving = priceInterval === "year" ? annualSavingPercent(plan.prices) : null;
    return (
      <Card key={`${plan.id}-${priceInterval}`} className="flex flex-col">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">{plan.name}</CardTitle>
            {plan.marketing.badge && <Badge variant="secondary">{plan.marketing.badge}</Badge>}
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
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> {f}
              </li>
            ))}
          </ul>
          {isCurrent ? (
            <Button disabled variant="outline">
              Current plan
            </Button>
          ) : (
            <Button
              onClick={() => checkout.mutate(price.id)}
              disabled={!canManage || !price.purchasable || checkout.isPending || verifying}
              title={!canManage ? "Only the workspace owner can buy plans" : !price.purchasable ? "Not available yet" : undefined}
            >
              {checkout.isPending && checkout.variables === price.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {price.purchasable ? plan.marketing.cta ?? "Choose" : "Coming soon"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">Payments are processed securely by Paystack.</p>
      </div>

      {verifying && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6 text-sm" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Confirming your payment with Paystack...
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" /> Your plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {state.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : sub ? (
            <>
              <p>
                <span className="font-medium">{sub.plan?.name ?? "Subscription"}</span>
                {sub.price && ` · ${formatMoney(sub.price.amount_minor, sub.price.currency)} ${intervalLabel(sub.price.billing_interval)}`}
              </p>
              <p>
                Status: <Badge variant={sub.status === "active" ? "default" : "secondary"}>{STATUS_LABELS[sub.status] ?? sub.status}</Badge>
              </p>
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
          ) : (
            <p className="text-muted-foreground">You are on the free plan.</p>
          )}
          {(state.data?.purchases ?? []).map((p) => (
            <p key={p.id}>
              <span className="font-medium">{p.plan?.name ?? "Purchase"}</span> · bought {formatDate(p.paid_at)}
              {p.access_expires_at ? ` · access until ${formatDate(p.access_expires_at)}` : ""}
            </p>
          ))}
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
            <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Billing interval">
              {(["month", "year"] as const).map((i) => (
                <Button key={i} size="sm" variant={interval === i ? "default" : "ghost"} onClick={() => setInterval(i)} aria-pressed={interval === i}>
                  {i === "month" ? "Monthly" : "Annual"}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{recurring.map((p) => planCard(p, interval))}</div>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What your workspace includes</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {(entitlements.data ?? []).map((e) => (
              <li key={e.entitlement_key} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <span>{e.entitlement_key.replace(/[._]/g, " ")}</span>
                <span className={e.enabled ? "font-medium" : "text-muted-foreground"}>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment history</CardTitle>
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
