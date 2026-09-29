// Starts a Paystack checkout for one price.
//
// Grants NOTHING. It creates a pending purchase / incomplete subscription
// and an 'initialized' billing_transactions row with OUR reference, then
// asks Paystack for a payment page. Access is granted only when a verified
// charge for that reference arrives (paystack-webhook, or billing-actions
// verify which re-checks with Paystack server-side) - never because the
// browser came back from the payment page.
//
// Authorization: the caller must hold manage_billing (owner) in the
// workspace. The price/plan are re-read server-side; the client only
// names a price id.
import {
  bearerToken, createCallerClient, createServiceClient, envVar, getCallerUserId, hasWorkspacePermission, json,
} from "../_shared/contentAuth.ts";
import { createCustomer, initializeTransaction, paystackConfigFromEnv } from "../_shared/billing/paystack.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, {}, 200);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const callerSb = createCallerClient(token);
  const userId = await getCallerUserId(callerSb);
  if (!userId) return json(req, { error: "Unauthorized" }, 401);

  let body: { workspace_id?: unknown; price_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const priceId = typeof body.price_id === "string" ? body.price_id : "";
  if (!workspaceId || !priceId) return json(req, { error: "workspace_id and price_id are required" }, 400);

  if (!(await hasWorkspacePermission(callerSb, workspaceId, "manage_billing"))) {
    return json(req, { error: "Only the workspace owner can manage billing" }, 403);
  }

  const cfg = paystackConfigFromEnv();
  if (!cfg.secretKey && !cfg.mockMode) return json(req, { error: "Payments are not available yet" }, 503);

  const sb = createServiceClient();

  const { data: price } = await sb
    .from("billing_prices")
    .select("id, plan_id, currency, amount_minor, billing_interval, paystack_plan_code, is_active, billing_plans!inner(id, code, name, plan_kind, is_active, is_public)")
    .eq("id", priceId)
    .maybeSingle();
  const plan = price?.billing_plans as { id: string; code: string; name: string; plan_kind: string; is_active: boolean; is_public: boolean } | undefined;
  if (!price || !price.is_active || !plan || !plan.is_active || !plan.is_public || plan.plan_kind === "free") {
    return json(req, { error: "This plan is not available" }, 400);
  }
  const recurring = price.billing_interval !== "once";
  if (recurring && !price.paystack_plan_code) return json(req, { error: "This plan is not available for purchase yet" }, 400);
  if (recurring !== (plan.plan_kind === "subscription")) return json(req, { error: "This plan is not available" }, 400);

  // Billing email = the caller's account email (verified by Supabase Auth).
  const { data: userData } = await callerSb.auth.getUser();
  const email = userData?.user?.email as string | undefined;
  if (!email) return json(req, { error: "Your account has no email address" }, 400);

  // Customer mapping (one Paystack customer per workspace).
  let { data: customer } = await sb.from("billing_customers").select("provider_customer_code").eq("workspace_id", workspaceId).eq("provider", "paystack").maybeSingle();
  if (!customer) {
    try {
      const created = await createCustomer(cfg, email);
      const { data: ins, error } = await sb
        .from("billing_customers")
        .upsert({ workspace_id: workspaceId, provider: "paystack", provider_customer_code: created.customer_code, email }, { onConflict: "workspace_id,provider" })
        .select("provider_customer_code")
        .single();
      if (error) throw new Error(error.message);
      customer = ins;
    } catch (e) {
      console.error("billing-checkout customer create failed", e instanceof Error ? e.message : e);
      return json(req, { error: "Could not start checkout. Please try again." }, 502);
    }
  }

  const reference = `sf_${crypto.randomUUID().replace(/-/g, "")}`;
  let purchaseId: string | null = null;
  let subscriptionId: string | null = null;

  if (recurring) {
    const { data: sub, error } = await sb
      .from("workspace_subscriptions")
      .insert({ workspace_id: workspaceId, plan_id: plan.id, price_id: price.id, status: "incomplete", provider: "paystack", provider_customer_code: customer!.provider_customer_code, created_by: userId })
      .select("id")
      .single();
    if (error) return json(req, { error: "Could not start checkout" }, 500);
    subscriptionId = sub.id;
  } else {
    const { data: pur, error } = await sb
      .from("workspace_purchases")
      .insert({ workspace_id: workspaceId, plan_id: plan.id, price_id: price.id, status: "pending", provider: "paystack", provider_reference: reference, amount_minor: price.amount_minor, currency: price.currency, created_by: userId })
      .select("id")
      .single();
    if (error) return json(req, { error: "Could not start checkout" }, 500);
    purchaseId = pur.id;
  }

  const { error: txnError } = await sb.from("billing_transactions").insert({
    workspace_id: workspaceId,
    reference,
    kind: recurring ? "subscription_initial" : "purchase",
    purchase_id: purchaseId,
    subscription_id: subscriptionId,
    price_id: price.id,
    amount_minor: price.amount_minor,
    currency: price.currency,
    created_by: userId,
  });
  if (txnError) return json(req, { error: "Could not start checkout" }, 500);

  let appBaseUrl: string;
  try {
    appBaseUrl = envVar("APP_BASE_URL").replace(/\/+$/, "");
  } catch {
    return json(req, { error: "Payments are not available yet" }, 503);
  }
  const callbackUrl = `${appBaseUrl}/app/billing?reference=${encodeURIComponent(reference)}`;

  try {
    const init = await initializeTransaction(cfg, {
      email,
      amountMinor: Number(price.amount_minor),
      currency: price.currency,
      reference,
      callbackUrl,
      planCode: recurring ? price.paystack_plan_code : null,
      // Informational only - never used to decide which workspace is paid for.
      metadata: { workspace_id: workspaceId, plan_code: plan.code, stabiflow_reference: reference },
    });
    await sb.from("billing_transactions").update({ authorization_url: init.authorization_url }).eq("reference", reference);
    return json(req, { ok: true, reference, authorization_url: init.authorization_url });
  } catch (e) {
    console.error("billing-checkout initialize failed", e instanceof Error ? e.message : e);
    await sb.from("billing_transactions").update({ status: "failed", failure_reason: "Checkout could not be started" }).eq("reference", reference);
    return json(req, { error: "Could not start checkout. Please try again." }, 502);
  }
});
