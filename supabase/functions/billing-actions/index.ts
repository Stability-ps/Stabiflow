// Customer-facing billing actions (one dispatcher, like leads-actions):
//
//  * verify  { workspace_id, reference }
//      Called when the browser returns from Paystack. Asks PAYSTACK (server
//      to server) for the transaction status and applies it through the
//      same atomic function as the webhook. The browser's return itself
//      proves nothing; a forged ?reference= only triggers a real lookup.
//  * cancel  { workspace_id }
//      Stops renewal at Paystack and marks the live subscription
//      'cancelled' - access continues until the paid period ends.
//
// Authorization: member of the workspace to verify its own reference;
// manage_billing (owner) to cancel.
import {
  bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json,
} from "../_shared/contentAuth.ts";
import { disableSubscription, paystackConfigFromEnv, verifyTransaction } from "../_shared/billing/paystack.ts";
import { processPaystackEvent } from "../_shared/billing/processPaystackEvent.ts";
import { sendBillingEmailForEvent } from "../_shared/billing/billingEmail.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, {}, 200);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const callerSb = createCallerClient(token);
  const userId = await getCallerUserId(callerSb);
  if (!userId) return json(req, { error: "Unauthorized" }, 401);

  let body: { action?: unknown; workspace_id?: unknown; reference?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  if (!workspaceId) return json(req, { error: "workspace_id is required" }, 400);

  const { data: isMember } = await callerSb.rpc("is_workspace_member", { p_workspace_id: workspaceId });
  if (isMember !== true) return json(req, { error: "Forbidden" }, 403);

  const cfg = paystackConfigFromEnv();
  if (!cfg.secretKey && !cfg.mockMode) return json(req, { error: "Payments are not available yet" }, 503);
  const sb = createServiceClient();

  if (body.action === "verify") {
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (!/^sf_[a-f0-9]{32}$/.test(reference)) return json(req, { error: "Invalid reference" }, 400);

    // The reference must belong to THIS workspace.
    const { data: txn } = await sb.from("billing_transactions").select("status, amount_minor, currency").eq("reference", reference).eq("workspace_id", workspaceId).maybeSingle();
    if (!txn) return json(req, { error: "Payment not found" }, 404);
    if (txn.status === "success") return json(req, { ok: true, status: "success" });

    let verified;
    try {
      verified = await verifyTransaction(cfg, reference, { amountMinor: Number(txn.amount_minor), currency: txn.currency });
    } catch (e) {
      console.error("billing-actions verify failed", e instanceof Error ? e.message : e);
      return json(req, { ok: true, status: "pending" });
    }
    if (verified.status !== "success") return json(req, { ok: true, status: verified.status === "failed" ? "failed" : "pending" });

    const verifiedEvent = {
      event: "charge.success",
      data: { reference, amount: verified.amount, currency: verified.currency, paid_at: verified.paid_at },
    };
    const outcome = await processPaystackEvent(sb, cfg, verifiedEvent, "verify_api");
    if (outcome.status === "processed" && outcome.workspaceId) {
      await sendBillingEmailForEvent(sb, verifiedEvent, outcome).catch((e) =>
        console.error("billing verify email failed", e instanceof Error ? e.message : "error")
      );
    }
    const applied = outcome.result.startsWith("applied") || outcome.result === "duplicate";
    return json(req, { ok: true, status: applied ? "success" : outcome.result === "amount_mismatch" ? "needs_review" : "pending" });
  }

  if (body.action === "cancel") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "manage_billing"))) {
      return json(req, { error: "Only the workspace owner can manage billing" }, 403);
    }
    const { data: sub } = await sb
      .from("workspace_subscriptions")
      .select("id, status, provider_subscription_code, provider_email_token")
      .eq("workspace_id", workspaceId)
      .in("status", ["active", "past_due", "grace"])
      .maybeSingle();
    if (!sub) return json(req, { error: "No active subscription" }, 404);

    if (sub.provider_subscription_code) {
      if (!sub.provider_email_token) return json(req, { error: "Could not cancel automatically - please contact support" }, 409);
      try {
        await disableSubscription(cfg, sub.provider_subscription_code, sub.provider_email_token);
      } catch (e) {
        console.error("billing-actions cancel failed", e instanceof Error ? e.message : e);
        return json(req, { error: "Could not cancel right now. Please try again." }, 502);
      }
    }
    const { data: ok, error } = await sb.rpc("billing_transition_subscription", {
      p_subscription_id: sub.id, p_expected_from: sub.status, p_to: "cancelled", p_reason: "Cancelled by customer", p_actor: "customer",
    });
    if (error || ok !== true) return json(req, { error: "Could not cancel right now. Please try again." }, 500);
    return json(req, { ok: true, status: "cancelled" });
  }

  return json(req, { error: "Unknown action" }, 400);
});
