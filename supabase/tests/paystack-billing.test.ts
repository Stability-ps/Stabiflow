// Paystack billing SQL layer - LOCAL-Supabase integration tests. No
// Paystack call anywhere: these exercise the atomic grant functions the
// webhook / verify / reconcile paths all funnel into.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, type TestTenant } from "./helpers";

type Ent = { entitlement_key: string; enabled: boolean };

async function enabled(t: TestTenant, key: string): Promise<boolean> {
  const { data, error } = await admin.rpc("get_workspace_entitlements", { p_workspace_id: t.workspaceId });
  if (error) throw new Error(error.message);
  return (data as Ent[]).find((e) => e.entitlement_key === key)?.enabled ?? false;
}

async function price(planCode: string, interval: string) {
  const { data } = await admin
    .from("billing_prices")
    .select("id, plan_id, amount_minor, currency, billing_plans!inner(code)")
    .eq("billing_plans.code", planCode)
    .eq("billing_interval", interval)
    .eq("is_active", true)
    .limit(1)
    .single();
  return data as { id: string; plan_id: string; amount_minor: number; currency: string };
}

const ref = () => `sf_${crypto.randomUUID().replace(/-/g, "")}`;

async function startPurchase(t: TestTenant) {
  const p = await price("profile_once", "once");
  const reference = ref();
  const { data: pur } = await admin
    .from("workspace_purchases")
    .insert({ workspace_id: t.workspaceId, plan_id: p.plan_id, price_id: p.id, status: "pending", amount_minor: p.amount_minor, currency: p.currency, provider_reference: reference })
    .select("id")
    .single();
  await admin.from("billing_transactions").insert({ workspace_id: t.workspaceId, reference, kind: "purchase", purchase_id: pur!.id, price_id: p.id, amount_minor: p.amount_minor, currency: p.currency });
  return { reference, purchaseId: pur!.id as string, p };
}

async function startSubscription(t: TestTenant, plan = "business") {
  const p = await price(plan, "month");
  await admin.from("billing_prices").update({ paystack_plan_code: `PLN_test${plan}` }).eq("id", p.id);
  const reference = ref();
  const { data: sub } = await admin
    .from("workspace_subscriptions")
    .insert({ workspace_id: t.workspaceId, plan_id: p.plan_id, price_id: p.id, status: "incomplete" })
    .select("id")
    .single();
  await admin.from("billing_transactions").insert({ workspace_id: t.workspaceId, reference, kind: "subscription_initial", subscription_id: sub!.id, price_id: p.id, amount_minor: p.amount_minor, currency: p.currency });
  return { reference, subscriptionId: sub!.id as string, p };
}

const apply = (reference: string, amount: number, currency = "ZAR") =>
  admin.rpc("billing_apply_charge_success", { p_reference: reference, p_amount_minor: amount, p_currency: currency, p_paid_at: new Date().toISOString(), p_via: "webhook" });

describe("Paystack billing - atomic grant functions", () => {
  let A: TestTenant;
  let B: TestTenant;

  beforeAll(async () => {
    A = await createTestTenant("paystack-a");
    B = await createTestTenant("paystack-b");
  });

  afterAll(async () => {
    await admin.from("billing_prices").update({ paystack_plan_code: null }).like("paystack_plan_code", "PLN_test%");
    await cleanupTenant(A);
    await cleanupTenant(B);
  });

  it("a pending purchase grants nothing until a verified charge is applied", async () => {
    const { reference, purchaseId, p } = await startPurchase(A);
    expect(await enabled(A, "business_profile.pdf_export")).toBe(false);
    const { data } = await apply(reference, p.amount_minor);
    expect(data).toBe("applied");
    expect(await enabled(A, "business_profile.pdf_export")).toBe(true);
    const { data: pur } = await admin.from("workspace_purchases").select("status, paid_at").eq("id", purchaseId).single();
    expect(pur?.status).toBe("paid");
  });

  it("applying the same charge twice is a no-op duplicate", async () => {
    const { reference, p } = await startPurchase(A);
    expect((await apply(reference, p.amount_minor)).data).toBe("applied");
    expect((await apply(reference, p.amount_minor)).data).toBe("duplicate");
  });

  it("an underpayment or wrong currency grants nothing and is flagged", async () => {
    const { reference, purchaseId, p } = await startPurchase(B);
    expect((await apply(reference, p.amount_minor - 1)).data).toBe("amount_mismatch");
    const { data: txn } = await admin.from("billing_transactions").select("status, failure_reason").eq("reference", reference).single();
    expect(txn?.status).toBe("amount_mismatch");
    const { data: pur } = await admin.from("workspace_purchases").select("status").eq("id", purchaseId).single();
    expect(pur?.status).toBe("pending");
    expect(await enabled(B, "business_profile.pdf_export")).toBe(false);

    const second = await startPurchase(B);
    expect((await apply(second.reference, second.p.amount_minor, "USD")).data).toBe("amount_mismatch");
  });

  it("an unknown reference is reported, never guessed", async () => {
    expect((await apply("sf_doesnotexist000000000000000000000", 100)).data).toBe("unknown_reference");
  });

  it("first subscription payment activates the subscription with a paid period", async () => {
    const { reference, subscriptionId, p } = await startSubscription(A);
    expect(await enabled(A, "hosted_profile.publish")).toBe(false);
    expect((await apply(reference, p.amount_minor)).data).toBe("applied");
    const { data: sub } = await admin.from("workspace_subscriptions").select("status, current_period_end").eq("id", subscriptionId).single();
    expect(sub?.status).toBe("active");
    expect(Date.parse(sub!.current_period_end!)).toBeGreaterThan(Date.now() + 25 * 86400000);
    expect(await enabled(A, "hosted_profile.publish")).toBe(true);
    const { data: events } = await admin.from("billing_subscription_events").select("to_status").eq("subscription_id", subscriptionId);
    expect(events?.map((e) => e.to_status)).toContain("active");
  });

  it("subscription.create links the provider code; renewals extend the period idempotently", async () => {
    const { data: cust, error: custErr } = await admin
      .from("billing_customers")
      .insert({ workspace_id: A.workspaceId, provider_customer_code: `CUS_${A.workspaceId.slice(0, 8)}`, email: "a@example.com" })
      .select("provider_customer_code")
      .single();
    expect(custErr).toBeNull();
    const code = `SUB_${crypto.randomUUID().slice(0, 8)}`;
    const next = new Date(Date.now() + 30 * 86400000).toISOString();
    const { data: linked } = await admin.rpc("billing_link_provider_subscription", {
      p_customer_code: cust!.provider_customer_code, p_plan_code: "PLN_testbusiness", p_subscription_code: code, p_email_token: "tok", p_next_payment_at: next,
    });
    expect(linked).toBe("linked");

    const renewalRef = `T${Date.now()}`;
    const renewalNext = new Date(Date.now() + 60 * 86400000).toISOString();
    const p = await price("business", "month");
    const renew = () => admin.rpc("billing_apply_renewal", {
      p_subscription_code: code, p_reference: renewalRef, p_amount_minor: p.amount_minor, p_currency: "ZAR",
      p_paid_at: new Date().toISOString(), p_next_payment_at: renewalNext, p_via: "webhook",
    });
    expect((await renew()).data).toBe("applied");
    expect((await renew()).data).toBe("duplicate");
    const { data: sub } = await admin.from("workspace_subscriptions").select("current_period_end").eq("provider_subscription_code", code).single();
    expect(new Date(sub!.current_period_end!).toISOString()).toBe(renewalNext);
  });

  it("the transition matrix rejects illegal jumps and stale expectations", async () => {
    const { data: sub } = await admin.from("workspace_subscriptions").select("id, status").eq("workspace_id", A.workspaceId).eq("status", "active").single();
    const { data: stale } = await admin.rpc("billing_transition_subscription", { p_subscription_id: sub!.id, p_expected_from: "grace", p_to: "expired", p_reason: "t", p_actor: "system" });
    expect(stale).toBe(false);
    const { error: illegal } = await admin.rpc("billing_transition_subscription", { p_subscription_id: sub!.id, p_expected_from: "active", p_to: "incomplete", p_reason: "t", p_actor: "system" });
    expect(illegal).not.toBeNull();
    const { data: ok } = await admin.rpc("billing_transition_subscription", { p_subscription_id: sub!.id, p_expected_from: "active", p_to: "cancelled", p_reason: "customer", p_actor: "customer" });
    expect(ok).toBe(true);
    // Cancelled keeps access until the paid period ends.
    expect(await enabled(A, "hosted_profile.publish")).toBe(true);
  });

  it("a new subscription payment replaces (expires) an existing live one", async () => {
    const first = await startSubscription(B);
    await apply(first.reference, first.p.amount_minor);
    const second = await startSubscription(B, "growth");
    expect((await apply(second.reference, second.p.amount_minor)).data).toBe("applied_replaced");
    const { data: old } = await admin.from("workspace_subscriptions").select("status").eq("id", first.subscriptionId).single();
    expect(old?.status).toBe("expired");
  });

  it("clients cannot call the grant functions or read webhook events / customer mappings", async () => {
    const { reference, p } = await startPurchase(A);
    const { error } = await A.client.rpc("billing_apply_charge_success", { p_reference: reference, p_amount_minor: p.amount_minor, p_currency: "ZAR", p_paid_at: null, p_via: "webhook" });
    expect(error).not.toBeNull();
    const { error: tErr } = await A.client.rpc("billing_transition_subscription", { p_subscription_id: crypto.randomUUID(), p_expected_from: "active", p_to: "expired", p_reason: "x", p_actor: "customer" });
    expect(tErr).not.toBeNull();
    await admin.from("billing_webhook_events").insert({ dedupe_key: `test-${Date.now()}`, event_type: "charge.success", signature_valid: true, payload: {}, workspace_id: A.workspaceId });
    const { data: ev } = await A.client.from("billing_webhook_events").select("*");
    expect(ev).toEqual([]);
    const { data: cu } = await A.client.from("billing_customers").select("*");
    expect(cu).toEqual([]);
  });

  it("members see their own transactions but not another workspace's", async () => {
    const { data: own } = await A.client.from("billing_transactions").select("reference").eq("workspace_id", A.workspaceId);
    expect((own ?? []).length).toBeGreaterThan(0);
    const { data: other } = await A.client.from("billing_transactions").select("reference").eq("workspace_id", B.workspaceId);
    expect(other).toEqual([]);
  });

  it("webhook dedupe key is unique", async () => {
    const key = `dup-${Date.now()}`;
    await admin.from("billing_webhook_events").insert({ dedupe_key: key, event_type: "x", signature_valid: true, payload: {} });
    const { error } = await admin.from("billing_webhook_events").insert({ dedupe_key: key, event_type: "x", signature_valid: true, payload: {} });
    expect((error as { code?: string } | null)?.code).toBe("23505");
    await admin.from("billing_webhook_events").delete().like("dedupe_key", "dup-%");
    await admin.from("billing_webhook_events").delete().like("dedupe_key", "test-%");
  });

  it("public platform settings are readable; private ones are not", async () => {
    const { data } = await A.client.from("platform_settings").select("key");
    const keys = (data ?? []).map((r) => r.key);
    expect(keys).toContain("support.contact");
    expect(keys).not.toContain("billing.grace_days");
  });
});
