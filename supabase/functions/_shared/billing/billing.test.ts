import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hmacSha512Hex, verifyPaystackSignature, paystackConfigFromEnv } from "./paystack.ts";
import { decideLifecycle, type SubscriptionSnapshot } from "./subscriptionLifecycle.ts";
import { processPaystackEvent } from "./processPaystackEvent.ts";

// -- Signature -----------------------------------------------------------------

Deno.test("verifyPaystackSignature accepts the HMAC-SHA512 of the raw body and rejects everything else", async () => {
  const secret = "sk_test_abc";
  const body = JSON.stringify({ event: "charge.success", data: { reference: "sf_1" } });
  const sig = await hmacSha512Hex(secret, body);
  assertEquals(await verifyPaystackSignature(secret, body, sig), true);
  assertEquals(await verifyPaystackSignature(secret, body, sig.toUpperCase()), true);
  assertEquals(await verifyPaystackSignature(secret, body + " ", sig), false); // body tampered
  assertEquals(await verifyPaystackSignature("sk_test_other", body, sig), false); // wrong key
  assertEquals(await verifyPaystackSignature(secret, body, null), false);
  assertEquals(await verifyPaystackSignature(secret, body, ""), false);
});

Deno.test("mock mode is refused next to a live secret key", () => {
  const prevKey = Deno.env.get("PAYSTACK_SECRET_KEY");
  const prevMock = Deno.env.get("PAYSTACK_MOCK_MODE");
  try {
    Deno.env.set("PAYSTACK_MOCK_MODE", "true");
    Deno.env.set("PAYSTACK_SECRET_KEY", "sk_live_xyz");
    assertEquals(paystackConfigFromEnv().mockMode, false);
    Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test_xyz");
    assertEquals(paystackConfigFromEnv().mockMode, true);
  } finally {
    if (prevKey === undefined) Deno.env.delete("PAYSTACK_SECRET_KEY");
    else Deno.env.set("PAYSTACK_SECRET_KEY", prevKey);
    if (prevMock === undefined) Deno.env.delete("PAYSTACK_MOCK_MODE");
    else Deno.env.set("PAYSTACK_MOCK_MODE", prevMock);
  }
});

// -- Lifecycle -----------------------------------------------------------------

const DAY = 86_400_000;
const now = new Date("2026-10-15T12:00:00Z");
const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY).toISOString();
const sub = (over: Partial<SubscriptionSnapshot>): SubscriptionSnapshot => ({ id: "s1", status: "active", current_period_end: iso(10), grace_until: null, created_at: iso(-40), ...over });

Deno.test("active inside its period: no change", () => {
  assertEquals(decideLifecycle(sub({}), now, 7), null);
});

Deno.test("active within the 1-day renewal settle window: no change yet", () => {
  assertEquals(decideLifecycle(sub({ current_period_end: iso(-0.5) }), now, 7), null);
});

Deno.test("active past period + settle window -> grace until period_end + grace days", () => {
  const d = decideLifecycle(sub({ current_period_end: iso(-2) }), now, 7);
  assertEquals(d?.to, "grace");
  assertEquals(d?.graceUntil, iso(5));
});

Deno.test("past_due long past period with grace already elapsed -> expired directly", () => {
  assertEquals(decideLifecycle(sub({ status: "past_due", current_period_end: iso(-10) }), now, 7)?.to, "expired");
});

Deno.test("grace elapsed -> expired; grace running -> no change", () => {
  assertEquals(decideLifecycle(sub({ status: "grace", grace_until: iso(-0.1) }), now, 7)?.to, "expired");
  assertEquals(decideLifecycle(sub({ status: "grace", grace_until: iso(1) }), now, 7), null);
});

Deno.test("cancelled keeps access until period end, then expires", () => {
  assertEquals(decideLifecycle(sub({ status: "cancelled", current_period_end: iso(3) }), now, 7), null);
  assertEquals(decideLifecycle(sub({ status: "cancelled", current_period_end: iso(-0.01) }), now, 7)?.to, "expired");
});

Deno.test("incomplete checkout older than 2 days expires; newer one is left alone", () => {
  assertEquals(decideLifecycle(sub({ status: "incomplete", created_at: iso(-3), current_period_end: null }), now, 7)?.to, "expired");
  assertEquals(decideLifecycle(sub({ status: "incomplete", created_at: iso(-1), current_period_end: null }), now, 7), null);
});

Deno.test("expired is terminal", () => {
  assertEquals(decideLifecycle(sub({ status: "expired", current_period_end: iso(-100) }), now, 7), null);
});

// -- Event processor (fake client) -------------------------------------------------

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(opts: { rpc?: Record<string, unknown>; rows?: Record<string, unknown[]> } = {}) {
  const calls: Call[] = [];
  const updates: { table: string; patch: unknown }[] = [];
  const builder = (table: string) => {
    const q: Record<string, unknown> = {};
    const rows = () => opts.rows?.[table] ?? [];
    for (const m of ["select", "eq", "in", "not", "gte", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res);
    q.update = (patch: unknown) => {
      updates.push({ table, patch });
      return q;
    };
    return q;
  };
  return {
    calls,
    updates,
    client: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: opts.rpc?.[fn] ?? null, error: null });
      },
      from: builder,
    },
  };
}

const cfg = { secretKey: "sk_test", mockMode: true };

Deno.test("charge.success with our reference goes through the atomic apply function", async () => {
  const f = fakeClient({ rpc: { billing_apply_charge_success: "applied" }, rows: { billing_transactions: [{ workspace_id: "w1" }] } });
  const r = await processPaystackEvent(f.client, cfg, { event: "charge.success", data: { reference: "sf_x", amount: 24900, currency: "ZAR", paid_at: "2026-10-01T00:00:00Z" } }, "webhook");
  assertEquals(r, { status: "processed", result: "applied", workspaceId: "w1" });
  assertEquals(f.calls[0].fn, "billing_apply_charge_success");
  assertEquals(f.calls[0].args.p_amount_minor, 24900);
});

Deno.test("a redelivered charge.success is reported as ignored duplicate", async () => {
  const f = fakeClient({ rpc: { billing_apply_charge_success: "duplicate" }, rows: { billing_transactions: [{ workspace_id: "w1" }] } });
  const r = await processPaystackEvent(f.client, cfg, { event: "charge.success", data: { reference: "sf_x", amount: 24900, currency: "ZAR" } }, "webhook");
  assertEquals(r.status, "ignored");
});

Deno.test("charge.success missing an amount never calls the apply function", async () => {
  const f = fakeClient();
  const r = await processPaystackEvent(f.client, cfg, { event: "charge.success", data: { reference: "sf_x", currency: "ZAR" } }, "webhook");
  assertEquals(r.status, "failed");
  assertEquals(f.calls.length, 0);
});

Deno.test("metadata is never used to pick a workspace: unknown reference without provider codes is ignored", async () => {
  const f = fakeClient({ rpc: { billing_apply_charge_success: "unknown_reference" } });
  const r = await processPaystackEvent(f.client, cfg, {
    event: "charge.success",
    data: { reference: "attacker", amount: 1, currency: "ZAR", metadata: { workspace_id: "victim" } },
  }, "webhook");
  assertEquals(r.status, "ignored");
  assertEquals(f.calls.length, 1);
});

Deno.test("invoice.payment_failed moves an active subscription to past_due via the guarded transition", async () => {
  const f = fakeClient({ rpc: { billing_transition_subscription: true }, rows: { workspace_subscriptions: [{ id: "s1", workspace_id: "w1", status: "active", current_period_end: null }] } });
  const r = await processPaystackEvent(f.client, cfg, { event: "invoice.payment_failed", data: { subscription: { subscription_code: "SUB_1" } } }, "webhook");
  assertEquals(r.result, "past_due");
  assertEquals(f.calls[0].args.p_expected_from, "active");
  assertEquals(f.calls[0].args.p_to, "past_due");
});

Deno.test("subscription.not_renew cancels but keeps access (cancelled, not expired)", async () => {
  const f = fakeClient({ rpc: { billing_transition_subscription: true }, rows: { workspace_subscriptions: [{ id: "s1", workspace_id: "w1", status: "active", current_period_end: "2099-01-01T00:00:00Z" }] } });
  const r = await processPaystackEvent(f.client, cfg, { event: "subscription.not_renew", data: { subscription_code: "SUB_1" } }, "webhook");
  assertEquals(r.result, "cancelled");
});

Deno.test("subscription.disable after the period ended expires the subscription", async () => {
  const f = fakeClient({ rpc: { billing_transition_subscription: true }, rows: { workspace_subscriptions: [{ id: "s1", workspace_id: "w1", status: "cancelled", current_period_end: "2000-01-01T00:00:00Z" }] } });
  const r = await processPaystackEvent(f.client, cfg, { event: "subscription.disable", data: { subscription_code: "SUB_1" } }, "webhook");
  assertEquals(r.result, "expired");
});

Deno.test("refund.processed reverses the transaction and refunds the purchase", async () => {
  const f = fakeClient({ rows: { billing_transactions: [{ id: "t1", workspace_id: "w1", purchase_id: "p1", status: "success" }] } });
  const r = await processPaystackEvent(f.client, cfg, { event: "refund.processed", data: { transaction_reference: "sf_x" } }, "webhook");
  assertEquals(r.result, "reversed");
  assertEquals(f.updates.map((u) => u.table), ["billing_transactions", "workspace_purchases"]);
});

Deno.test("unknown events are ignored, not failed", async () => {
  const f = fakeClient();
  const r = await processPaystackEvent(f.client, cfg, { event: "transfer.success", data: {} }, "webhook");
  assertEquals(r.status, "ignored");
});

Deno.test("an unknown Paystack reference is a definite 'not paid', other failures are not", async () => {
  const { isUnknownReferenceError } = await import("./paystack.ts");
  assertEquals(isUnknownReferenceError(new Error("Paystack /transaction/verify/sf_1 failed: Transaction reference not found.")), true);
  assertEquals(isUnknownReferenceError(new Error("Paystack /transaction/verify/sf_1 failed: 503 Service Unavailable")), false);
  assertEquals(isUnknownReferenceError("Transaction reference not found"), false);
});
