import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/EmptyState";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  annualSavingPercent, cancelSubscription, entitlementLabel, fetchBillingState, fetchCatalog, fetchEntitlementNames, fetchEntitlements, formatMoney, intervalLabel, isOurReference,
  startCheckout, verifyPayment, type BillingInterval, type CatalogPlan,
} from "@/lib/billing";
import { GuideHelpLink } from "@/components/guide/GuideHelpLink";

const VERIFY_ATTEMPTS = 6;
const VERIFY_DELAY_MS = 3000;
const PENDING_CHECKOUT_KEY = "stabiflow.pendingCheckout";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  past_due: "Payment failed - retrying",
  grace: "Payment overdue",
  cancelled: "Cancelled - ends at period end",
};

const STATUS_TONES: Record<string, StatusTone> = {
  active: "success",
  past_due: "warning",
  grace: "warning",
  cancelled: "neutral",
};

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

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
  const [previousPurchasesOpen, setPreviousPurchasesOpen] = useState(false);
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

  const entitlementNames = useQuery({ queryKey: ["entitlement-names"], queryFn: fetchEntitlementNames, staleTime: 30 * 60_000 });

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
  const currentSubscriptionPlan = sub?.plan?.code ? recurring.find((p) => p.code === sub.plan?.code) ?? null : null;
  const availableRecurring = sub && currentSubscriptionPlan
    ? recurring.filter((p) => (p.tier_rank ?? 0) > (currentSubscriptionPlan.tier_rank ?? 0))
    : recurring;

  const planCard = (plan: CatalogPlan, priceInterval: BillingInterval) => {
    const price = plan.prices.find((p) => p.billing_interval === priceInterval);
    if (!price) return null;
    const isCurrent = !!sub && sub.plan?.code === plan.code && sub.price?.billing_interval === priceInterval && sub.status !== "cancelled";
    const samePlanDifferentInterval = !!sub && sub.plan?.code === plan.code && sub.price?.billing_interval !== priceInterval && sub.status !== "cancelled";
    const purchase = plan.plan_kind === "one_off"
      ? purchases.find((p) => p.plan?.code === plan.code)
      : undefined;
    const isPurchased = !!purchase && (!purchase.access_expires_at || new Date(purchase.access_expires_at).getTime() > Date.now());
    const saving = priceInterval === "year" ? annualSavingPercent(plan.prices) : null;
    return (
      <div key={`${plan.id}-${priceInterval}`} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-title-section text-foreground">{plan.name}</h3>
            {plan.marketing.badge && <StatusPill tone="brand" dot={false}>{plan.marketing.badge}</StatusPill>}
          </div>
          {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
        </div>
        <div>
          <span className="text-metric tabular-nums text-foreground">{formatMoney(price.amount_minor, price.currency)}</span>
          <span className="ml-1 text-sm text-muted-foreground">{intervalLabel(price.billing_interval)}</span>
          {saving && <p className="mt-0.5 text-xs font-medium text-success">Save {saving}% vs monthly</p>}
        </div>
        <ul className="flex-1 space-y-1.5 text-sm text-foreground">
          {(plan.marketing.features ?? []).map((f) => (
            <li key={f} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> {f}
            </li>
          ))}
        </ul>
        {isPurchased ? (
          <div className="space-y-1.5">
            <p className="flex h-10 items-center justify-center gap-2 rounded-md bg-success-soft text-sm font-medium text-success"><Check className="h-4 w-4" aria-hidden="true" /> Purchased</p>
            <p className="text-center text-xs text-muted-foreground">Bought {formatDate(purchase.paid_at)}</p>
          </div>
        ) : isCurrent ? (
          <p className="flex h-10 items-center justify-center gap-2 rounded-md bg-success-soft text-sm font-medium text-success"><Check className="h-4 w-4" aria-hidden="true" /> Current plan</p>
        ) : (
          <Button
            className="w-full"
            onClick={() => checkout.mutate(price.id)}
            disabled={!canManage || !price.purchasable || checkout.isPending || verifying}
            title={!canManage ? "Only the workspace owner can buy plans" : !price.purchasable ? "Not available yet" : undefined}
          >
            {checkout.isPending && checkout.variables === price.id && <Loader2 className="animate-spin" aria-hidden="true" />}
            {price.purchasable
              ? plan.plan_kind === "subscription"
                ? samePlanDifferentInterval
                  ? `Switch to ${priceInterval === "year" ? "annual" : "monthly"}`
                  : `Upgrade to ${plan.name}`
                : plan.marketing.cta ?? "Choose"
              : "Coming soon"}
          </Button>
        )}
      </div>
    );
  };

  const entitlementRows = (entitlements.data ?? []).filter((e) => e.enabled || e.kind === "boolean");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header className="min-w-0">
        <h1 className="text-title-page text-foreground">Billing & plans</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose the plan that fits your business. Payments are processed securely by Paystack.</p>
        <GuideHelpLink chapter="billing" label="How plans and payments work" className="mt-1" />
      </header>

      {verifying && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Confirming your payment with Paystack...
        </div>
      )}

      {state.isError ? (
        // Never fall back to "Free" when we simply couldn't read the plan:
        // that tells a paying customer they've lost what they paid for.
        <Panel>
          <EmptyState
            icon={AlertTriangle}
            title="Couldn't load your plan"
            description="We couldn't reach billing just now. Nothing has changed on your subscription - try again."
            action={<Button variant="outline" onClick={() => void state.refetch()}>Try again</Button>}
          />
        </Panel>
      ) : (
        <Panel aria-labelledby="billing-current-plan">
          <PanelHeader
            titleId="billing-current-plan"
            title={<span className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Current plan</span>}
            action={state.isLoading ? null : sub ? (
              <StatusPill tone={STATUS_TONES[sub.status] ?? "warning"}>{STATUS_LABELS[sub.status] ?? sub.status}</StatusPill>
            ) : highestPurchase ? (
              <StatusPill tone="success">Purchased</StatusPill>
            ) : (
              <StatusPill tone="neutral">Free</StatusPill>
            )}
          />
          <PanelBody className="space-y-4 text-sm">
            {state.isLoading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading your plan">
                <div className="h-6 w-40 animate-pulse rounded bg-muted" />
                <div className="h-4 w-64 animate-pulse rounded bg-muted" />
              </div>
            ) : sub ? (
              <>
                <div>
                  <p className="text-title-section text-foreground">{sub.plan?.name ?? "Subscription"}</p>
                  {sub.price && <p className="mt-0.5 text-muted-foreground">{formatMoney(sub.price.amount_minor, sub.price.currency)} {intervalLabel(sub.price.billing_interval)}</p>}
                </div>
                {sub.status === "grace" && sub.grace_until && (
                  <p className="rounded-lg bg-warning-soft px-3 py-2 text-warning">Your last payment did not go through. Access continues until {formatDate(sub.grace_until)} - please update your card with Paystack.</p>
                )}
                {sub.status === "past_due" && <p className="rounded-lg bg-warning-soft px-3 py-2 text-warning">Your last renewal failed. Paystack will retry the payment.</p>}
                <p className="text-muted-foreground">
                  {sub.status === "cancelled" ? "Access ends" : "Next renewal"}: <span className="text-foreground">{formatDate(sub.current_period_end)}</span>
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
                  <p className="text-title-section text-foreground">{highestPurchase.plan?.name ?? "Purchased plan"}</p>
                  <p className="mt-0.5 text-muted-foreground">
                    Purchased {formatDate(highestPurchase.paid_at)}
                    {highestPurchase.access_expires_at ? ` · access until ${formatDate(highestPurchase.access_expires_at)}` : " · yours permanently"}
                  </p>
                </div>
                {purchases.length > 1 && (
                  <ul className="flex flex-wrap gap-2" aria-label="Other purchases">
                    {purchases.filter((p) => p.id !== highestPurchase.id).map((p) => (
                      <li key={p.id}><StatusPill tone="neutral" dot={false}>{p.plan?.name ?? "Purchase"} · bought {formatDate(p.paid_at)}</StatusPill></li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div>
                <p className="text-title-section text-foreground">Free</p>
                <p className="mt-0.5 text-muted-foreground">Start with the essentials, then upgrade when you are ready.</p>
              </div>
            )}

            {entitlements.isError ? (
              <p role="alert" className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-destructive-strong">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Couldn't load what your plan includes.
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void entitlements.refetch()}>Try again</Button>
              </p>
            ) : entitlementRows.length > 0 && (
              <div className="border-t border-border pt-3">
                <h3 className="mb-1 text-label text-muted-foreground">What your plan includes</h3>
                <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  {entitlementRows.map((e) => (
                    <li key={e.entitlement_key} className="flex min-w-0 items-center gap-2 py-1.5">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${e.enabled ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
                        {e.enabled ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                      </span>
                      <span className={`min-w-0 flex-1 truncate ${e.enabled ? "text-foreground" : "text-muted-foreground"}`}>
                        {entitlementLabel(e.entitlement_key, entitlementNames.data)}
                      </span>
                      <span className={`shrink-0 text-xs font-medium tabular-nums ${e.enabled ? "text-success" : "text-muted-foreground"}`}>
                        {e.kind === "boolean"
                          ? e.enabled ? "Included" : "Not included"
                          : !e.enabled ? "Not included"
                          : e.unlimited ? "Unlimited"
                          : e.kind === "allowance" ? `${e.used}/${e.limit_value}`
                          : `Up to ${e.limit_value}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </PanelBody>
        </Panel>
      )}

      {!canManage && <p className="text-sm text-muted-foreground">Only the workspace owner can buy or change plans.</p>}

      {catalog.isError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive-strong">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Couldn't load the available plans.</span>
          <Button variant="outline" size="sm" className="bg-card" onClick={() => void catalog.refetch()}>Try again</Button>
        </div>
      )}

      {oneOff.length > 0 && (
        <Panel>
          <button
            type="button"
            className="flex min-h-14 w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors duration-fast hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => setPreviousPurchasesOpen((open) => !open)}
            aria-expanded={previousPurchasesOpen}
            aria-controls="previous-purchases-content"
          >
            <div className="min-w-0">
              <p className="text-title-card text-foreground">Previous purchases</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {highestPurchase
                  ? `${purchases.length} once-off purchase${purchases.length === 1 ? "" : "s"}`
                  : "View once-off products"}
              </p>
            </div>
            <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-fast ${previousPurchasesOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {previousPurchasesOpen && (
            <div id="previous-purchases-content" className="border-t border-border bg-background p-4">
              <div className="grid max-w-xl gap-4">{oneOff.map((p) => planCard(p, "once"))}</div>
            </div>
          )}
        </Panel>
      )}

      {availableRecurring.length > 0 && (
        <section aria-labelledby="billing-plans" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 id="billing-plans" className="text-title-section text-foreground">{sub ? "Upgrade your plan" : "Available plans"}</h2>
              <p className="text-sm text-muted-foreground">{sub ? "Choose a higher plan when your business needs more capacity." : "Choose the subscription that fits your business."}</p>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-muted p-0.5" role="group" aria-label="Billing interval">
              {(["month", "year"] as const).map((i) => (
                <Button key={i} size="sm" variant={interval === i ? "outline" : "ghost"} onClick={() => setInterval(i)} aria-pressed={interval === i}>
                  {i === "month" ? "Monthly" : "Annual"}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">{availableRecurring.map((p) => planCard(p, interval))}</div>
        </section>
      )}

      {(state.data?.transactions ?? []).length > 0 && (
        <Panel aria-labelledby="billing-history">
          <PanelHeader titleId="billing-history" title="Payment history" description="Your most recent StabiFlow payments." />
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-overline uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2 font-medium">Date</th>
                  <th scope="col" className="px-4 py-2 font-medium">Amount</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {state.data!.transactions.map((t) => (
                  <tr key={t.reference} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-foreground">{formatDate(t.paid_at ?? t.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-foreground">{formatMoney(t.amount_minor, t.currency)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.status === "initialized" ? "Not completed" : sentenceCase(t.status.replace(/_/g, " "))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
