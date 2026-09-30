// Plans, pricing and entitlements - LOCAL-Supabase integration tests.
// Covers: the canonical evaluator (free baseline, subscription, once-off
// purchase, grace/cancelled/expired windows, operator override incl.
// revoke), allowance consumption, catalogue write lock-down, holdings not
// client-writable, workspace_billing plan/limits no longer owner-editable,
// and cross-tenant entitlement reads refused.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, type TestTenant } from "./helpers";

type Ent = { entitlement_key: string; enabled: boolean; limit_value: number | null; unlimited: boolean; used: number; source: string };

async function planId(code: string): Promise<string> {
  const { data } = await admin.from("billing_plans").select("id").eq("code", code).single();
  return data!.id as string;
}

async function priceId(code: string, interval: string): Promise<string> {
  const pid = await planId(code);
  const { data } = await admin.from("billing_prices").select("id").eq("plan_id", pid).eq("billing_interval", interval).eq("is_active", true).limit(1).single();
  return data!.id as string;
}

async function ents(t: TestTenant): Promise<Record<string, Ent>> {
  const { data, error } = await t.client.rpc("get_workspace_entitlements", { p_workspace_id: t.workspaceId });
  if (error) throw new Error(error.message);
  return Object.fromEntries((data as Ent[]).map((e) => [e.entitlement_key, e]));
}

const DAY = 24 * 60 * 60 * 1000;

describe("Plans, pricing and entitlements - canonical evaluator", () => {
  let A: TestTenant;
  let B: TestTenant;

  beforeAll(async () => {
    A = await createTestTenant("ent-a");
    B = await createTestTenant("ent-b");
  });

  afterAll(async () => {
    await cleanupTenant(A);
    await cleanupTenant(B);
  });

  it("a new workspace gets only the free baseline", async () => {
    const e = await ents(A);
    expect(e["business_studio.access"].enabled).toBe(true);
    expect(e["business_studio.access"].source).toBe("free");
    expect(e["business_profile.pdf_export"].enabled).toBe(false);
    expect(e["hosted_profile.publish"].enabled).toBe(false);
    expect(e["business_profile.documents"].limit_value).toBe(1);
  });

  it("an incomplete (unpaid) subscription grants nothing", async () => {
    await admin.from("workspace_subscriptions").insert({ workspace_id: A.workspaceId, plan_id: await planId("business"), status: "incomplete" });
    const e = await ents(A);
    expect(e["hosted_profile.publish"].enabled).toBe(false);
  });

  it("an active subscription grants its plan; limits take the larger value", async () => {
    const { data: sub } = await admin
      .from("workspace_subscriptions")
      .insert({
        workspace_id: A.workspaceId,
        plan_id: await planId("business"),
        price_id: await priceId("business", "month"),
        status: "active",
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * DAY).toISOString(),
      })
      .select("id")
      .single();
    const e = await ents(A);
    expect(e["hosted_profile.publish"].enabled).toBe(true);
    expect(e["business_profile.documents"].limit_value).toBe(10);
    expect(e["hosted_profile.publish"].source).toContain("subscription");

    // grace: expired period but grace_until in the future keeps access
    await admin.from("workspace_subscriptions").update({ status: "grace", current_period_end: new Date(Date.now() - 2 * DAY).toISOString(), grace_until: new Date(Date.now() + 3 * DAY).toISOString() }).eq("id", sub!.id);
    expect((await ents(A))["hosted_profile.publish"].enabled).toBe(true);

    // grace elapsed -> no access
    await admin.from("workspace_subscriptions").update({ grace_until: new Date(Date.now() - DAY).toISOString() }).eq("id", sub!.id);
    expect((await ents(A))["hosted_profile.publish"].enabled).toBe(false);

    // cancelled but still inside paid period -> access until period end
    await admin.from("workspace_subscriptions").update({ status: "cancelled", current_period_end: new Date(Date.now() + 5 * DAY).toISOString() }).eq("id", sub!.id);
    expect((await ents(A))["hosted_profile.publish"].enabled).toBe(true);

    await admin.from("workspace_subscriptions").update({ status: "expired" }).eq("id", sub!.id);
    expect((await ents(A))["hosted_profile.publish"].enabled).toBe(false);
  });

  it("only one live subscription per workspace", async () => {
    const business = await planId("business");
    const growth = await planId("growth");
    const { error: e1 } = await admin.from("workspace_subscriptions").insert({ workspace_id: B.workspaceId, plan_id: business, status: "active" });
    expect(e1).toBeNull();
    const { error: e2 } = await admin.from("workspace_subscriptions").insert({ workspace_id: B.workspaceId, plan_id: growth, status: "active" });
    expect(e2).not.toBeNull();
    await admin.from("workspace_subscriptions").delete().eq("workspace_id", B.workspaceId);
  });

  it("a paid once-off purchase grants PDF export; a pending one does not", async () => {
    const pid = await planId("profile_once");
    const price = await priceId("profile_once", "once");
    const { data: pur } = await admin
      .from("workspace_purchases")
      .insert({ workspace_id: A.workspaceId, plan_id: pid, price_id: price, status: "pending", amount_minor: 29900, provider_reference: `test-${Date.now()}` })
      .select("id")
      .single();
    expect((await ents(A))["business_profile.pdf_export"].enabled).toBe(false);
    await admin.from("workspace_purchases").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", pur!.id);
    const e = await ents(A);
    expect(e["business_profile.pdf_export"].enabled).toBe(true);
    expect(e["business_profile.pdf_export"].source).toBe("purchase");
    // Once-off purchase does NOT grant subscription-only features.
    expect(e["hosted_profile.publish"].enabled).toBe(false);
  });

  it("an operator override is authoritative - it can grant and revoke", async () => {
    await admin.from("workspace_entitlement_overrides").insert({ workspace_id: A.workspaceId, entitlement_key: "hosted_profile.publish", bool_value: true, reason: "pilot customer" });
    expect((await ents(A))["hosted_profile.publish"]).toMatchObject({ enabled: true, source: "override" });

    await admin.from("workspace_entitlement_overrides").insert({ workspace_id: A.workspaceId, entitlement_key: "business_studio.access", bool_value: false, reason: "abuse" });
    expect((await ents(A))["business_studio.access"].enabled).toBe(false);

    await admin.from("workspace_entitlement_overrides").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("workspace_id", A.workspaceId);
    const e = await ents(A);
    expect(e["business_studio.access"].enabled).toBe(true);
    expect(e["hosted_profile.publish"].enabled).toBe(false);
  });

  it("allowances are consumed atomically and refuse overage", async () => {
    // free: website_scans = 2 / month
    const consume = () => admin.rpc("consume_entitlement", { p_workspace_id: B.workspaceId, p_key: "website_scans", p_amount: 1 });
    expect((await consume()).data).toBe(true);
    expect((await consume()).data).toBe(true);
    expect((await consume()).data).toBe(false);
    const e = await ents(B);
    expect(e.website_scans.used).toBe(2);
  });

  it("clients cannot consume allowances directly", async () => {
    const { error } = await B.client.rpc("consume_entitlement", { p_workspace_id: B.workspaceId, p_key: "website_scans", p_amount: 1 });
    expect(error).not.toBeNull();
  });

  it("workspace A cannot read workspace B's entitlements or holdings", async () => {
    const { error } = await A.client.rpc("get_workspace_entitlements", { p_workspace_id: B.workspaceId });
    expect(error).not.toBeNull();
    const { data } = await A.client.from("entitlement_usage").select("*").eq("workspace_id", B.workspaceId);
    expect(data).toEqual([]);
  });

  it("clients cannot grant themselves access (subscriptions, purchases, overrides are service-role only)", async () => {
    const business = await planId("business");
    const { error: s } = await A.client.from("workspace_subscriptions").insert({ workspace_id: A.workspaceId, plan_id: business, status: "active" });
    expect(s).not.toBeNull();
    const { error: o } = await A.client.from("workspace_entitlement_overrides").insert({ workspace_id: A.workspaceId, entitlement_key: "hosted_profile.publish", bool_value: true, reason: "me" });
    expect(o).not.toBeNull();
    const { data: p } = await A.client.from("workspace_purchases").update({ status: "paid" }).eq("workspace_id", A.workspaceId).select();
    expect(p).toEqual([]);
  });

  it("the catalogue is readable but not client-writable", async () => {
    const { data, error } = await A.client.from("billing_plans").select("code").eq("code", "business");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const { data: upd } = await A.client.from("billing_prices").update({ is_active: false }).neq("id", "00000000-0000-0000-0000-000000000000").select();
    expect(upd).toEqual([]);
  });

  it("price terms are immutable", async () => {
    const price = await priceId("business", "month");
    const { error } = await admin.from("billing_prices").update({ amount_minor: 1 }).eq("id", price);
    expect(error).not.toBeNull();
  });

  it("workspace owners can no longer change workspace_billing plan or AI limits", async () => {
    const { error: planErr } = await A.client.from("workspace_billing").update({ plan: "enterprise" }).eq("workspace_id", A.workspaceId);
    expect(planErr).not.toBeNull();
    const { error: limErr } = await A.client.from("workspace_billing").update({ limits: { flow_ai_monthly_token_limit: 999999999 } }).eq("workspace_id", A.workspaceId);
    expect(limErr).not.toBeNull();
  });
});
