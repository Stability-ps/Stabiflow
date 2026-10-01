import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { readText, usePublicSettings } from "@/hooks/usePublicSettings";
import { annualSavingPercent, fetchCatalog, formatMoney, intervalLabel } from "@/lib/billing";

type Faq = { question: string; answer: string };

/**
 * Public pricing page. Plans, prices, benefits, intro copy and FAQs all
 * come from the database (Admin -> Plans & pricing / Pages & legal) - no
 * prices are written in this file.
 */
const PENDING_CHECKOUT_KEY = "stabiflow.pendingCheckout";

export default function Pricing() {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const catalog = useQuery({ queryKey: ["billing-catalog"], queryFn: fetchCatalog, staleTime: 5 * 60_000 });
  const { data: settings } = usePublicSettings();
  const intro = readText(settings?.["content.pricing_intro"], "text", 400);
  const faqRaw = settings?.["content.faq"];
  const faq: Faq[] = Array.isArray(faqRaw)
    ? faqRaw.filter((f): f is Faq => !!f && typeof f === "object" && typeof (f as Faq).question === "string" && typeof (f as Faq).answer === "string").slice(0, 30)
    : [];

  const plans = catalog.data ?? [];
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/"><BrandLogo variant="full" className="h-7" /></Link>
          <nav className="flex gap-4 text-sm"><Link to="/login">Sign in</Link><Link to="/signup" className="font-medium">Get started</Link></nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-10 px-4 py-10">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold">Pricing</h1>
          {intro && <p className="mx-auto max-w-2xl text-muted-foreground">{intro}</p>}
        </div>
        <div className="flex justify-center">
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Billing interval">
            {(["month", "year"] as const).map((i) => (
              <Button key={i} size="sm" variant={interval === i ? "default" : "ghost"} onClick={() => setInterval(i)} aria-pressed={interval === i}>
                {i === "month" ? "Monthly" : "Annual"}
              </Button>
            ))}
          </div>
        </div>
        {catalog.isLoading && <Loader2 className="mx-auto h-6 w-6 animate-spin" />}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const price = plan.plan_kind === "one_off" ? plan.prices.find((p) => p.billing_interval === "once") : plan.plan_kind === "free" ? null : plan.prices.find((p) => p.billing_interval === interval);
            if (plan.plan_kind !== "free" && !price) return null;
            const saving = plan.plan_kind === "subscription" && interval === "year" ? annualSavingPercent(plan.prices) : null;
            return (
              <Card key={plan.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <p>
                    <span className="text-2xl font-semibold">{price ? formatMoney(price.amount_minor, price.currency) : formatMoney(0, "ZAR")}</span>
                    <span className="ml-1 text-sm text-muted-foreground">{price ? intervalLabel(price.billing_interval) : "free"}</span>
                  </p>
                  {saving && <p className="text-xs text-emerald-700">Save {saving}% vs monthly</p>}
                  <ul className="flex-1 space-y-1 text-sm">
                    {(plan.marketing.features ?? []).map((f) => (
                      <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> {f}</li>
                    ))}
                  </ul>
                  <Button asChild>
                    <Link
                      to="/signup"
                      onClick={() => {
                        if (price) {
                          sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify({ priceId: price.id, planCode: plan.code }));
                        } else {
                          sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
                        }
                      }}
                    >
                      {plan.marketing.cta ?? "Get started"}
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {faq.length > 0 && (
          <section className="mx-auto max-w-3xl space-y-4">
            <h2 className="text-xl font-semibold">Frequently asked questions</h2>
            {faq.map((f) => (
              <details key={f.question} className="rounded-md border p-4">
                <summary className="cursor-pointer font-medium">{f.question}</summary>
                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{f.answer}</p>
              </details>
            ))}
          </section>
        )}
        <p className="text-center text-xs text-muted-foreground">
          Prices in South African Rand. See our <Link className="underline" to="/legal/subscription-terms">subscription terms</Link> and <Link className="underline" to="/legal/refunds">refund policy</Link>.
        </p>
      </main>
    </div>
  );
}
