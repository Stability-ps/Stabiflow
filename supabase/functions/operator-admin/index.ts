// Platform Admin (operator) - configuration and oversight for the whole
// platform: overview metrics, plans/prices/entitlements, feature flags,
// platform settings & public copy, subscriptions/payments/webhooks,
// per-workspace commercial state + entitlement overrides, system status,
// and the admin audit log.
//
// Same authorization model as operator-workspaces: the ONLY gate is
// profiles.is_platform_operator, re-checked via the service-role client on
// every call. Every mutation validates input first (adminValidation.ts)
// and writes a before/after row to platform_admin_audit. Secrets are
// reported as configured/missing only - no value ever leaves this function.
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, json, type AnySupabaseClient } from "../_shared/contentAuth.ts";
import {
  isUuid, reasonOf, secretStatus, validateFlagUpdate, validateOverride, validatePlan, validatePlanEntitlement, validatePrice, validatePriceUpdate,
  validateLegalDraft, validateSettingUpdate,
} from "../_shared/operator/adminValidation.ts";

const PAGE = 50;
const DAY = 86_400_000;

async function audit(sb: AnySupabaseClient, row: {
  operator: string; action: string; targetType: string; targetId?: string | null; workspaceId?: string | null; reason?: string | null; before?: unknown; after?: unknown;
}) {
  const { error } = await sb.from("platform_admin_audit").insert({
    operator_user_id: row.operator,
    action: row.action,
    target_type: row.targetType,
    target_id: row.targetId ?? null,
    workspace_id: row.workspaceId ?? null,
    reason: row.reason ?? null,
    before_state: row.before ?? null,
    after_state: row.after ?? null,
  });
  if (error) throw new Error(`audit write failed: ${error.message}`);
}

async function count(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count: c } = await q;
  return c ?? 0;
}

function monthlyEquivalent(amountMinor: number, interval: string): number {
  return interval === "year" ? amountMinor / 12 : interval === "month" ? amountMinor : 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, {}, 200);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const actorId = await getCallerUserId(createCallerClient(token));
  if (!actorId) return json(req, { error: "Forbidden" }, 403);
  const sb = createServiceClient();
  const { data: prof } = await sb.from("profiles").select("is_platform_operator").eq("id", actorId).maybeSingle();
  if (prof?.is_platform_operator !== true) return json(req, { error: "Forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      // -- Overview ----------------------------------------------------------------
      case "overview": {
        const since30 = new Date(Date.now() - 30 * DAY).toISOString();
        const since7 = new Date(Date.now() - 7 * DAY).toISOString();
        const [workspaces, newWorkspaces, users, liveSubs, revenueRows, failedWebhooks, mismatches, pendingCheckouts, aiRows, failedAutomations, failedPosts, identities] = await Promise.all([
          count(sb.from("workspaces").select("id", { count: "exact", head: true })),
          count(sb.from("workspaces").select("id", { count: "exact", head: true }).gte("created_at", since30)),
          count(sb.from("profiles").select("id", { count: "exact", head: true })),
          sb.from("workspace_subscriptions").select("status, billing_plans(code, name), billing_prices(amount_minor, billing_interval)").in("status", ["active", "past_due", "grace", "cancelled"]),
          sb.from("billing_transactions").select("paid_amount_minor, currency").eq("status", "success").gte("paid_at", since30),
          count(sb.from("billing_webhook_events").select("id", { count: "exact", head: true }).eq("processing_status", "failed").gte("received_at", since7)),
          count(sb.from("billing_transactions").select("id", { count: "exact", head: true }).eq("status", "amount_mismatch")),
          count(sb.from("billing_transactions").select("id", { count: "exact", head: true }).eq("status", "initialized")),
          sb.from("ai_usage_events").select("estimated_cost, total_tokens").gte("created_at", since30).limit(10000),
          count(sb.from("automation_runs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since7)),
          count(sb.from("content_scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", since7)),
          count(sb.from("business_identities").select("id", { count: "exact", head: true }).not("website", "is", null)),
        ]);
        type SubRow = { status: string; billing_plans: { code: string; name: string } | null; billing_prices: { amount_minor: number; billing_interval: string } | null };
        const subs = (liveSubs.data ?? []) as SubRow[];
        const byPlan: Record<string, { name: string; count: number }> = {};
        let mrrMinor = 0;
        for (const s of subs) {
          const code = s.billing_plans?.code ?? "unknown";
          byPlan[code] = { name: s.billing_plans?.name ?? code, count: (byPlan[code]?.count ?? 0) + 1 };
          if (s.status !== "cancelled" && s.billing_prices) mrrMinor += monthlyEquivalent(Number(s.billing_prices.amount_minor), s.billing_prices.billing_interval);
        }
        const revenue30Minor = ((revenueRows.data ?? []) as { paid_amount_minor: number | null }[]).reduce((a, r) => a + Number(r.paid_amount_minor ?? 0), 0);
        const ai = (aiRows.data ?? []) as { estimated_cost: number | null; total_tokens: number | null }[];
        return json(req, {
          ok: true,
          workspaces, newWorkspaces30d: newWorkspaces, users,
          subscriptions: { total: subs.length, byPlan, pastDueOrGrace: subs.filter((s) => s.status === "past_due" || s.status === "grace").length },
          mrrMinor: Math.round(mrrMinor), revenue30dMinor: revenue30Minor, currency: "ZAR",
          billingAlerts: { failedWebhooks7d: failedWebhooks, amountMismatches: mismatches, pendingCheckouts },
          ai30d: { costUsd: ai.reduce((a, r) => a + Number(r.estimated_cost ?? 0), 0), tokens: ai.reduce((a, r) => a + Number(r.total_tokens ?? 0), 0) },
          failures7d: { automations: failedAutomations, contentPosts: failedPosts },
          businessProfilesWithWebsite: identities,
        });
      }

      case "usage_overview": {
        const since30 = new Date(Date.now() - 30 * DAY).toISOString();
        const [aiRows, usageRows, automationRows] = await Promise.all([
          sb.from("ai_usage_events").select("feature, estimated_cost, total_tokens").gte("created_at", since30).limit(10000),
          sb.from("entitlement_usage").select("workspace_id, entitlement_key, used, period_start, workspaces(name)").in("entitlement_key", ["creative_generations", "automation_runs", "whatsapp_ai_turns"]).order("used", { ascending: false }).limit(5000),
          sb.from("automation_runs").select("status").gte("created_at", since30).limit(10000),
        ]);
        const ai = (aiRows.data ?? []) as { feature: string | null; estimated_cost: number | null; total_tokens: number | null }[];
        const byFeature: Record<string, { tokens: number; cost_usd: number; calls: number }> = {};
        let tokens = 0, costUsd = 0;
        for (const row of ai) {
          const feature = row.feature || "unknown";
          const t = Number(row.total_tokens ?? 0), cost = Number(row.estimated_cost ?? 0);
          tokens += t; costUsd += cost;
          const cur = byFeature[feature] ?? { tokens: 0, cost_usd: 0, calls: 0 };
          cur.tokens += t; cur.cost_usd += cost; cur.calls += 1; byFeature[feature] = cur;
        }
        const usage = (usageRows.data ?? []) as { workspace_id: string; entitlement_key: string; used: number; workspaces: { name: string } | null }[];
        const allowances = [];
        for (const row of usage) {
          const { data: ents } = await sb.rpc("get_workspace_entitlements", { p_workspace_id: row.workspace_id });
          const ent = ((ents ?? []) as { entitlement_key: string; limit_value: number | null; unlimited: boolean }[]).find((x) => x.entitlement_key === row.entitlement_key);
          const limit = ent?.limit_value ?? null;
          allowances.push({
            workspace_id: row.workspace_id, workspace_name: row.workspaces?.name ?? row.workspace_id.slice(0, 8), key: row.entitlement_key,
            used: Number(row.used ?? 0), limit, unlimited: ent?.unlimited ?? false,
            pct: limit && limit > 0 ? (Number(row.used ?? 0) / limit) * 100 : null,
          });
        }
        const runs = (automationRows.data ?? []) as { status: string }[];
        return json(req, {
          ok: true,
          ai30d: { tokens, cost_usd: costUsd, by_feature: byFeature },
          allowances,
          automation30d: { total: runs.length, blocked_usage_limit: runs.filter((r) => r.status === "blocked_usage_limit").length, failed: runs.filter((r) => r.status === "failed").length },
        });
      }

      case "launch_readiness": {
        const since7 = new Date(Date.now() - 7 * DAY).toISOString();
        const appBase = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/+$/, "");
        const [plansRes, failedWebhooks, mismatches, pendingCheckouts, legalVersions, flagsRes, growthEntitlements] = await Promise.all([
          sb.from("billing_plans").select("code, name, is_public, is_active, plan_kind, billing_prices(id, is_active, paystack_plan_code, billing_interval)").in("code", ["free", "profile_once", "business", "growth"]).order("sort_order"),
          count(sb.from("billing_webhook_events").select("id", { count: "exact", head: true }).eq("processing_status", "failed").gte("received_at", since7)),
          count(sb.from("billing_transactions").select("id", { count: "exact", head: true }).eq("status", "amount_mismatch")),
          count(sb.from("billing_transactions").select("id", { count: "exact", head: true }).eq("status", "initialized")),
          sb.from("legal_document_versions").select("document_type, current_version").in("document_type", ["privacy_policy", "terms_of_service"]),
          sb.from("feature_flags").select("key, is_enabled, audience, plan_codes").in("key", ["module.content", "module.leads", "module.customers", "module.whatsapp", "module.campaigns", "module.creative_studio", "module.analytics", "module.flow_ai", "module.automations", "module.integrations"]),
          sb.from("plan_entitlements").select("entitlement_key, limit_value, billing_plans!inner(code)").eq("billing_plans.code", "growth").in("entitlement_key", ["creative_generations", "automation_runs", "whatsapp_ai_turns"]),
        ]);
        type Price = { id: string; is_active: boolean; paystack_plan_code: string | null; billing_interval: string };
        type Plan = { code: string; name: string; is_public: boolean; is_active: boolean; plan_kind: string; billing_prices: Price[] };
        type FlagRow = { key: string; is_enabled: boolean; audience: string; plan_codes: string[] };
        const rawPlans = (plansRes.data ?? []) as Plan[];
        const paystackMode = Deno.env.get("PAYSTACK_SECRET_KEY")?.startsWith("sk_live_") ? "live" : Deno.env.get("PAYSTACK_SECRET_KEY") ? "test" : "not_configured";
        const plans = rawPlans.map((p) => ({
          code: p.code, name: p.name, is_public: p.is_public, is_active: p.is_active,
          prices: p.billing_prices.length,
          purchasable_prices: p.billing_prices.filter((x) => x.is_active && (x.billing_interval === "once" || !!x.paystack_plan_code)).length,
        }));
        const checks: { key: string; label: string; status: "pass" | "warn" | "fail"; detail: string }[] = [];

        const commercial = plans.filter((p) => p.code === "profile_once" || p.code === "business" || p.code === "growth");
        const badPlan = commercial.find((p) => !p.is_active || !p.is_public || p.prices === 0 || p.purchasable_prices === 0);
        checks.push({ key: "catalog", label: "Public commercial catalogue", status: badPlan ? "fail" : "pass", detail: badPlan ? "One or more paid plans is hidden, inactive or has no purchasable price." : "Profile, Business and Growth are active, public and have purchasable prices." });

        const flags = (flagsRes.data ?? []) as FlagRow[];
        const businessExpected = ["module.content", "module.leads", "module.customers"];
        const growthExpected = ["module.content", "module.leads", "module.customers", "module.whatsapp", "module.campaigns", "module.creative_studio", "module.analytics", "module.flow_ai", "module.automations", "module.integrations"];
        const badBusinessFlag = businessExpected.find((key) => {
          const f = flags.find((x) => x.key === key);
          return !f?.is_enabled || f.audience !== "targeted" || !f.plan_codes.includes("business");
        });
        const badGrowthFlag = growthExpected.find((key) => {
          const f = flags.find((x) => x.key === key);
          return !f?.is_enabled || f.audience !== "targeted" || !f.plan_codes.includes("growth");
        });
        checks.push({ key: "plan-modules", label: "Plan-to-module access", status: badBusinessFlag || badGrowthFlag ? "fail" : "pass", detail: badBusinessFlag || badGrowthFlag ? "One or more advertised modules is not mapped to the expected paid plan." : "Business and Growth module access matches the commercial catalogue." });

        const gEnts = (growthEntitlements.data ?? []) as { entitlement_key: string; limit_value: number | null }[];
        const expectedLimits: Record<string, number> = { creative_generations: 100, automation_runs: 1000, whatsapp_ai_turns: 500 };
        const badAllowance = Object.entries(expectedLimits).find(([key, value]) => gEnts.find((x) => x.entitlement_key === key)?.limit_value !== value);
        checks.push({ key: "usage-guardrails", label: "Growth usage guardrails", status: badAllowance ? "fail" : "pass", detail: badAllowance ? "Growth API/AI allowances do not match the certified limits." : "Growth has finite Creative Studio, automation and WhatsApp AI monthly allowances." });

        const legal = (legalVersions.data ?? []) as { document_type: string; current_version: string }[];
        const privacy = legal.find((x) => x.document_type === "privacy_policy")?.current_version;
        const terms = legal.find((x) => x.document_type === "terms_of_service")?.current_version;
        checks.push({ key: "legal", label: "Signup legal versioning", status: privacy && terms ? "pass" : "fail", detail: privacy && terms ? "Privacy Policy " + privacy + " and Terms " + terms + " are versioned for durable signup acceptance." : "Privacy Policy and Terms must both have current server-side versions." });

        let manifestOk = false, serviceWorkerOk = false, pricingOk = false, signupOk = false;
        if (appBase) {
          const probe = async (path: string) => {
            try {
              const res = await fetch(appBase + path, { redirect: "follow", signal: AbortSignal.timeout(3500), headers: { "User-Agent": "StabiFlow-Launch-Readiness/1.0" } });
              return res;
            } catch {
              return null;
            }
          };
          const [manifestRes, swRes, pricingRes, signupRes] = await Promise.all([probe("/manifest.webmanifest"), probe("/sw.js"), probe("/pricing"), probe("/signup")]);
          if (manifestRes?.ok) {
            try {
              const manifest = await manifestRes.json() as { name?: string; display?: string; start_url?: string; icons?: unknown[] };
              manifestOk = manifest.name === "StabiFlow" && manifest.display === "standalone" && typeof manifest.start_url === "string" && Array.isArray(manifest.icons) && manifest.icons.length >= 2;
            } catch { manifestOk = false; }
          }
          if (swRes?.ok) {
            const swText = await swRes.text().catch(() => "");
            serviceWorkerOk = swText.includes("self.addEventListener") && swText.includes("fetch");
          }
          pricingOk = !!pricingRes?.ok;
          signupOk = !!signupRes?.ok;
        }
        checks.push({ key: "public-routes", label: "Public signup and pricing routes", status: pricingOk && signupOk ? "pass" : appBase ? "warn" : "fail", detail: pricingOk && signupOk ? "Production signup and pricing routes respond successfully." : appBase ? "One or more production public routes could not be verified from the launch checker." : "APP_BASE_URL is not configured." });
        checks.push({ key: "pwa", label: "Installable mobile web app", status: manifestOk && serviceWorkerOk ? "pass" : appBase ? "warn" : "fail", detail: manifestOk && serviceWorkerOk ? "Production manifest and service worker are reachable and structurally valid." : appBase ? "Manifest or service worker could not be verified in production." : "APP_BASE_URL is not configured." });

        checks.push({ key: "paystack", label: "Paystack production credentials", status: paystackMode === "live" ? "pass" : "warn", detail: paystackMode === "live" ? "Live Paystack secret is configured." : paystackMode === "test" ? "Deferred: Paystack is still using a test secret." : "Deferred: PAYSTACK_SECRET_KEY is not configured yet." });
        checks.push({ key: "webhooks", label: "Payment webhook health", status: failedWebhooks === 0 ? "pass" : "warn", detail: failedWebhooks === 0 ? "No failed payment webhooks in the last 7 days." : String(failedWebhooks) + " failed payment webhook(s) in the last 7 days." });
        checks.push({ key: "mismatch", label: "Payment amount integrity", status: mismatches === 0 ? "pass" : "warn", detail: mismatches === 0 ? "No amount mismatches require review." : String(mismatches) + " amount mismatch transaction(s) require review." });

        const summary = { pass: checks.filter((x) => x.status === "pass").length, warn: checks.filter((x) => x.status === "warn").length, fail: checks.filter((x) => x.status === "fail").length };
        return json(req, {
          ok: true, checks, summary, plans,
          billing: { paystack_mode: paystackMode, failed_webhooks_7d: failedWebhooks, amount_mismatches: mismatches, pending_checkouts: pendingCheckouts },
          deferred: paystackMode === "live" ? [] : ["Run one controlled live checkout after PAYSTACK_SECRET_KEY is configured.", "Confirm the signed Paystack webhook is processed and the paid plan unlocks immediately.", "Confirm renewal/cancellation behavior against the live Paystack subscription."],
          mobile: { manifest: manifestOk, service_worker: serviceWorkerOk, installable_shell: manifestOk && serviceWorkerOk },
        });
      }

      // -- Catalogue ---------------------------------------------------------------
      case "list_catalog": {
        const [products, plans, definitions] = await Promise.all([
          sb.from("billing_products").select("*").order("created_at"),
          sb.from("billing_plans").select("*, billing_prices(*), plan_entitlements(*)").order("sort_order"),
          sb.from("entitlement_definitions").select("*").order("sort_order"),
        ]);
        return json(req, { ok: true, products: products.data ?? [], plans: plans.data ?? [], definitions: definitions.data ?? [] });
      }

      case "upsert_plan": {
        const v = validatePlan(body.plan);
        if (!v.ok) return json(req, { error: v.error }, 400);
        const { data: before } = await sb.from("billing_plans").select("*").eq("code", v.value.code).maybeSingle();
        const { data: product } = await sb.from("billing_products").select("id").eq("code", "business_studio").single();
        const { data, error } = await sb
          .from("billing_plans")
          .upsert({ ...v.value, product_id: before?.product_id ?? product.id }, { onConflict: "code" })
          .select("*")
          .single();
        if (error) return json(req, { error: error.message.includes("billing_plans_one_free") ? "There can only be one free plan" : "Could not save plan" }, 400);
        await audit(sb, { operator: actorId, action: before ? "update_plan" : "create_plan", targetType: "plan", targetId: data.id, before, after: data });
        return json(req, { ok: true, plan: data });
      }

      case "create_price": {
        const v = validatePrice(body.price);
        if (!v.ok) return json(req, { error: v.error }, 400);
        const { data: plan } = await sb.from("billing_plans").select("plan_kind").eq("id", v.value.plan_id).maybeSingle();
        if (!plan) return json(req, { error: "Plan not found" }, 404);
        if ((plan.plan_kind === "subscription") === (v.value.billing_interval === "once")) {
          return json(req, { error: plan.plan_kind === "subscription" ? "Subscription plans need a monthly or annual price" : "This plan only takes once-off prices" }, 400);
        }
        const { data, error } = await sb.from("billing_prices").insert(v.value).select("*").single();
        if (error) return json(req, { error: "Could not create price" }, 400);
        await audit(sb, { operator: actorId, action: "create_price", targetType: "price", targetId: data.id, after: data });
        return json(req, { ok: true, price: data });
      }

      case "update_price": {
        if (!isUuid(body.price_id)) return json(req, { error: "price_id is required" }, 400);
        const v = validatePriceUpdate(body.update);
        if (!v.ok) return json(req, { error: v.error }, 400);
        const { data: before } = await sb.from("billing_prices").select("*").eq("id", body.price_id).maybeSingle();
        if (!before) return json(req, { error: "Price not found" }, 404);
        if (v.value.paystack_plan_code && before.billing_interval === "once") return json(req, { error: "Once-off prices do not use a Paystack plan" }, 400);
        const { data, error } = await sb.from("billing_prices").update(v.value).eq("id", body.price_id).select("*").single();
        if (error) return json(req, { error: "Could not update price" }, 400);
        await audit(sb, { operator: actorId, action: "update_price", targetType: "price", targetId: data.id, before, after: data });
        return json(req, { ok: true, price: data });
      }

      case "set_plan_entitlement": {
        const v = validatePlanEntitlement(body.entitlement);
        if (!v.ok) return json(req, { error: v.error }, 400);
        const { data: before } = await sb.from("plan_entitlements").select("*").eq("plan_id", v.value.plan_id).eq("entitlement_key", v.value.entitlement_key).maybeSingle();
        const { data, error } = await sb.from("plan_entitlements").upsert(v.value, { onConflict: "plan_id,entitlement_key" }).select("*").single();
        if (error) return json(req, { error: "Could not save entitlement" }, 400);
        await audit(sb, { operator: actorId, action: "set_plan_entitlement", targetType: "plan_entitlement", targetId: `${v.value.plan_id}:${v.value.entitlement_key}`, before, after: data });
        return json(req, { ok: true, entitlement: data });
      }

      case "remove_plan_entitlement": {
        if (!isUuid(body.plan_id) || typeof body.entitlement_key !== "string") return json(req, { error: "plan_id and entitlement_key are required" }, 400);
        const { data: before } = await sb.from("plan_entitlements").select("*").eq("plan_id", body.plan_id).eq("entitlement_key", body.entitlement_key).maybeSingle();
        if (!before) return json(req, { error: "Not found" }, 404);
        await sb.from("plan_entitlements").delete().eq("plan_id", body.plan_id).eq("entitlement_key", body.entitlement_key);
        await audit(sb, { operator: actorId, action: "remove_plan_entitlement", targetType: "plan_entitlement", targetId: `${body.plan_id}:${body.entitlement_key}`, before });
        return json(req, { ok: true });
      }

      // -- Feature flags -----------------------------------------------------------
      case "list_flags": {
        const [flags, targets] = await Promise.all([
          sb.from("feature_flags").select("*").order("key"),
          sb.from("feature_flag_workspace_targets").select("flag_key, workspace_id, enabled, reason, created_at, workspaces(name, slug)").order("created_at", { ascending: false }).limit(2000),
        ]);
        return json(req, { ok: true, flags: flags.data ?? [], targets: targets.data ?? [] });
      }

      case "update_flag": {
        const key = typeof body.flag_key === "string" ? body.flag_key : "";
        const v = validateFlagUpdate(body.update);
        if (!v.ok) return json(req, { error: v.error }, 400);
        const r = reasonOf(body.reason);
        if (!r.ok) return json(req, { error: r.error }, 400);
        const { data: before } = await sb.from("feature_flags").select("*").eq("key", key).maybeSingle();
        if (!before) return json(req, { error: "Flag not found" }, 404);
        const { data, error } = await sb.from("feature_flags").update(v.value).eq("key", key).select("*").single();
        if (error) return json(req, { error: "Could not update flag" }, 400);
        await audit(sb, { operator: actorId, action: "update_flag", targetType: "feature_flag", targetId: key, reason: r.value, before, after: data });
        return json(req, { ok: true, flag: data });
      }

      case "set_flag_target": {
        const key = typeof body.flag_key === "string" ? body.flag_key : "";
        if (!isUuid(body.workspace_id) || typeof body.enabled !== "boolean") return json(req, { error: "workspace_id and enabled are required" }, 400);
        const r = reasonOf(body.reason);
        if (!r.ok) return json(req, { error: r.error }, 400);
        const { data: before } = await sb.from("feature_flag_workspace_targets").select("*").eq("flag_key", key).eq("workspace_id", body.workspace_id).maybeSingle();
        const { data, error } = await sb
          .from("feature_flag_workspace_targets")
          .upsert({ flag_key: key, workspace_id: body.workspace_id, enabled: body.enabled, reason: r.value, created_by: actorId }, { onConflict: "flag_key,workspace_id" })
          .select("*")
          .single();
        if (error) return json(req, { error: "Could not save target (unknown flag or workspace?)" }, 400);
        await audit(sb, { operator: actorId, action: "set_flag_target", targetType: "feature_flag", targetId: key, workspaceId: body.workspace_id, reason: r.value, before, after: data });
        return json(req, { ok: true, target: data });
      }

      case "remove_flag_target": {
        const key = typeof body.flag_key === "string" ? body.flag_key : "";
        if (!isUuid(body.workspace_id)) return json(req, { error: "workspace_id is required" }, 400);
        const r = reasonOf(body.reason);
        if (!r.ok) return json(req, { error: r.error }, 400);
        const { data: before } = await sb.from("feature_flag_workspace_targets").select("*").eq("flag_key", key).eq("workspace_id", body.workspace_id).maybeSingle();
        if (!before) return json(req, { error: "Not found" }, 404);
        await sb.from("feature_flag_workspace_targets").delete().eq("flag_key", key).eq("workspace_id", body.workspace_id);
        await audit(sb, { operator: actorId, action: "remove_flag_target", targetType: "feature_flag", targetId: key, workspaceId: body.workspace_id, reason: r.value, before });
        return json(req, { ok: true });
      }

      // -- Platform settings / public copy ---------------------------------------
      case "list_settings": {
        const { data } = await sb.from("platform_settings").select("*").order("key");
        return json(req, { ok: true, settings: data ?? [] });
      }

      case "update_setting": {
        const v = validateSettingUpdate(body.setting);
        if (!v.ok) return json(req, { error: v.error }, 400);
        const { data: before } = await sb.from("platform_settings").select("*").eq("key", v.value.key).maybeSingle();
        if (!before) return json(req, { error: "Unknown setting" }, 404);
        const { data, error } = await sb.from("platform_settings").update({ value: v.value.value, updated_by: actorId }).eq("key", v.value.key).select("*").single();
        if (error) return json(req, { error: "Could not save setting" }, 400);
        await audit(sb, { operator: actorId, action: "update_setting", targetType: "platform_setting", targetId: v.value.key, before: before.value, after: data.value });
        return json(req, { ok: true, setting: data });
      }

      // -- Subscriptions / payments / webhooks ------------------------------------
      case "list_subscriptions": {
        let q = sb
          .from("workspace_subscriptions")
          .select("id, workspace_id, status, current_period_end, grace_until, cancel_at_period_end, created_at, provider_subscription_code, workspaces(name, slug), billing_plans(code, name), billing_prices(amount_minor, currency, billing_interval)")
          .order("created_at", { ascending: false })
          .limit(PAGE);
        if (typeof body.status === "string" && body.status) q = q.eq("status", body.status);
        const { data } = await q;
        return json(req, { ok: true, subscriptions: data ?? [] });
      }

      case "list_transactions": {
        let q = sb
          .from("billing_transactions")
          .select("id, workspace_id, reference, kind, status, amount_minor, currency, paid_amount_minor, paid_at, verified_via, failure_reason, created_at, workspaces(name, slug)")
          .order("created_at", { ascending: false })
          .limit(PAGE);
        if (typeof body.status === "string" && body.status) q = q.eq("status", body.status);
        const { data } = await q;
        return json(req, { ok: true, transactions: data ?? [] });
      }

      case "list_webhook_events": {
        // The raw payload stays server-side; Admin sees type/status/result.
        let q = sb
          .from("billing_webhook_events")
          .select("id, event_type, signature_valid, processing_status, processing_result, workspace_id, received_at, processed_at")
          .order("received_at", { ascending: false })
          .limit(PAGE);
        if (typeof body.status === "string" && body.status) q = q.eq("processing_status", body.status);
        const { data } = await q;
        return json(req, { ok: true, events: data ?? [] });
      }

      // -- Per-workspace commercial state + overrides -----------------------------
      case "workspace_commercial": {
        if (!isUuid(body.workspace_id)) return json(req, { error: "workspace_id is required" }, 400);
        const ws = body.workspace_id;
        const [ents, flags, subs, purchases, overrides, identity] = await Promise.all([
          sb.rpc("get_workspace_entitlements", { p_workspace_id: ws }),
          sb.rpc("evaluate_feature_flags", { p_workspace_id: ws }),
          sb.from("workspace_subscriptions").select("id, status, current_period_end, grace_until, created_at, billing_plans(code, name)").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(10),
          sb.from("workspace_purchases").select("id, status, paid_at, access_expires_at, billing_plans(code, name)").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(10),
          sb.from("workspace_entitlement_overrides").select("*").eq("workspace_id", ws),
          sb.from("business_identities").select("trading_name, legal_name, website, industry, verification_status, updated_at").eq("workspace_id", ws).maybeSingle(),
        ]);
        return json(req, {
          ok: true,
          entitlements: ents.data ?? [], flags: flags.data ?? [], subscriptions: subs.data ?? [], purchases: purchases.data ?? [],
          overrides: overrides.data ?? [], identity: identity.data ?? null,
        });
      }

      case "grant_override": {
        const v = validateOverride(body.override);
        if (!v.ok) return json(req, { error: v.error }, 400);
        const r = reasonOf(body.reason);
        if (!r.ok) return json(req, { error: r.error }, 400);
        const { data: before } = await sb.from("workspace_entitlement_overrides").select("*").eq("workspace_id", v.value.workspace_id).eq("entitlement_key", v.value.entitlement_key).maybeSingle();
        const { data, error } = await sb
          .from("workspace_entitlement_overrides")
          .upsert({ ...v.value, reason: r.value, created_by: actorId }, { onConflict: "workspace_id,entitlement_key" })
          .select("*")
          .single();
        if (error) return json(req, { error: "Could not save override" }, 400);
        await audit(sb, { operator: actorId, action: "grant_override", targetType: "entitlement_override", targetId: v.value.entitlement_key, workspaceId: v.value.workspace_id, reason: r.value, before, after: data });
        return json(req, { ok: true, override: data });
      }

      case "revoke_override": {
        if (!isUuid(body.workspace_id) || typeof body.entitlement_key !== "string") return json(req, { error: "workspace_id and entitlement_key are required" }, 400);
        const r = reasonOf(body.reason);
        if (!r.ok) return json(req, { error: r.error }, 400);
        const { data: before } = await sb.from("workspace_entitlement_overrides").select("*").eq("workspace_id", body.workspace_id).eq("entitlement_key", body.entitlement_key).maybeSingle();
        if (!before) return json(req, { error: "Not found" }, 404);
        await sb.from("workspace_entitlement_overrides").delete().eq("id", before.id);
        await audit(sb, { operator: actorId, action: "revoke_override", targetType: "entitlement_override", targetId: body.entitlement_key, workspaceId: body.workspace_id, reason: r.value, before });
        return json(req, { ok: true });
      }

      // -- Business Studio oversight ---------------------------------------------------
      case "business_studio": {
        const [scans, docs, hosted, pending, templates] = await Promise.all([
          sb.from("website_scans").select("id, workspace_id, requested_url, final_url, purpose, status, pages_fetched, error, created_at, workspaces(name)").order("created_at", { ascending: false }).limit(PAGE),
          sb.from("business_documents").select("id, workspace_id, title, template_key, watermarked, page_count, created_at, workspaces(name)").order("created_at", { ascending: false }).limit(PAGE),
          sb.from("hosted_profiles").select("workspace_id, slug, is_published, published_at, updated_at, workspaces(name)").order("updated_at", { ascending: false }).limit(PAGE),
          count(sb.from("business_fact_proposals").select("id", { count: "exact", head: true }).eq("status", "pending")),
          sb.from("profile_templates").select("*").order("sort_order"),
        ]);
        return json(req, { ok: true, scans: scans.data ?? [], documents: docs.data ?? [], hostedProfiles: hosted.data ?? [], pendingProposals: pending, templates: templates.data ?? [] });
      }

      case "update_template": {
        const key = typeof body.template_key === "string" ? body.template_key : "";
        const u = body.update && typeof body.update === "object" ? (body.update as Record<string, unknown>) : {};
        const patch: Record<string, unknown> = {};
        if (typeof u.name === "string" && u.name.trim()) patch.name = u.name.trim().slice(0, 80);
        if (typeof u.description === "string") patch.description = u.description.trim().slice(0, 500) || null;
        if (typeof u.is_premium === "boolean") patch.is_premium = u.is_premium;
        if (typeof u.is_active === "boolean") patch.is_active = u.is_active;
        if (Object.keys(patch).length === 0) return json(req, { error: "Nothing to update" }, 400);
        const { data: before } = await sb.from("profile_templates").select("*").eq("key", key).maybeSingle();
        if (!before) return json(req, { error: "Template not found" }, 404);
        const { data, error } = await sb.from("profile_templates").update({ ...patch, updated_at: new Date().toISOString() }).eq("key", key).select("*").single();
        if (error) return json(req, { error: "Could not update template" }, 400);
        await audit(sb, { operator: actorId, action: "update_template", targetType: "profile_template", targetId: key, before, after: data });
        return json(req, { ok: true, template: data });
      }

      // -- Legal documents -----------------------------------------------------------
      case "list_legal": {
        const [docs, versions, stats] = await Promise.all([
          sb.from("legal_documents").select("id, document_type, version, title, body, change_summary, effective_at, status, published_at, created_at, updated_at").order("created_at", { ascending: false }),
          sb.from("legal_document_versions").select("document_type, current_version, effective_at"),
          sb.rpc("legal_acceptance_stats"),
        ]);
        return json(req, { ok: true, documents: docs.data ?? [], currentVersions: versions.data ?? [], acceptanceStats: stats.data ?? [] });
      }

      case "save_legal_draft": {
        const v = validateLegalDraft(body.document);
        if (!v.ok) return json(req, { error: v.error }, 400);
        const { id, ...fields } = v.value;
        if (id) {
          const { data: before } = await sb.from("legal_documents").select("*").eq("id", id).maybeSingle();
          if (!before) return json(req, { error: "Document not found" }, 404);
          if (before.status !== "draft") return json(req, { error: "Published documents can't be edited - create a new version" }, 400);
          const { data, error } = await sb.from("legal_documents").update(fields).eq("id", id).select("*").single();
          if (error) return json(req, { error: error.message.includes("legal_documents_document_type_version_key") ? "That version number already exists" : "Could not save draft" }, 400);
          await audit(sb, { operator: actorId, action: "update_legal_draft", targetType: "legal_document", targetId: id, before: { version: before.version, title: before.title }, after: { version: data.version, title: data.title } });
          return json(req, { ok: true, document: data });
        }
        const { data, error } = await sb.from("legal_documents").insert({ ...fields, status: "draft", created_by: actorId }).select("*").single();
        if (error) return json(req, { error: error.message.includes("legal_documents_document_type_version_key") ? "That version number already exists" : "Could not save draft" }, 400);
        await audit(sb, { operator: actorId, action: "create_legal_draft", targetType: "legal_document", targetId: data.id, after: { document_type: data.document_type, version: data.version } });
        return json(req, { ok: true, document: data });
      }

      case "delete_legal_draft": {
        if (!isUuid(body.document_id)) return json(req, { error: "document_id is required" }, 400);
        const { data: before } = await sb.from("legal_documents").select("id, status, document_type, version").eq("id", body.document_id).maybeSingle();
        if (!before) return json(req, { error: "Document not found" }, 404);
        if (before.status !== "draft") return json(req, { error: "Only drafts can be deleted - published versions are kept as history" }, 400);
        await sb.from("legal_documents").delete().eq("id", before.id);
        await audit(sb, { operator: actorId, action: "delete_legal_draft", targetType: "legal_document", targetId: before.id, before });
        return json(req, { ok: true });
      }

      case "publish_legal": {
        if (!isUuid(body.document_id)) return json(req, { error: "document_id is required" }, 400);
        const r = reasonOf(body.reason);
        if (!r.ok) return json(req, { error: r.error }, 400);
        const { data: before } = await sb.from("legal_documents").select("document_type, version, status").eq("id", body.document_id).maybeSingle();
        if (!before) return json(req, { error: "Document not found" }, 404);
        const { data: result, error } = await sb.rpc("publish_legal_document", { p_document_id: body.document_id, p_operator_id: actorId });
        if (error) return json(req, { error: "Could not publish" }, 500);
        if (result !== "published") return json(req, { error: `This version is already ${String(result).replace("already_", "")}` }, 400);
        await audit(sb, { operator: actorId, action: "publish_legal_document", targetType: "legal_document", targetId: String(body.document_id), reason: r.value, before, after: { status: "published" } });
        return json(req, { ok: true });
      }

      // -- System ------------------------------------------------------------------
      case "system_status": {
        const since7 = new Date(Date.now() - 7 * DAY).toISOString();
        const [automationRuns, posts, webhooks, whatsappEvents] = await Promise.all([
          sb.from("automation_runs").select("id, workspace_id, status, error, created_at").eq("status", "failed").gte("created_at", since7).order("created_at", { ascending: false }).limit(20),
          sb.from("content_scheduled_posts").select("id, workspace_id, status, updated_at").eq("status", "failed").gte("updated_at", since7).order("updated_at", { ascending: false }).limit(20),
          sb.from("billing_webhook_events").select("id, event_type, processing_result, received_at").eq("processing_status", "failed").gte("received_at", since7).order("received_at", { ascending: false }).limit(20),
          count(sb.from("workspace_whatsapp_webhook_events").select("id", { count: "exact", head: true }).gte("created_at", since7)),
        ]);
        return json(req, {
          ok: true,
          secrets: secretStatus((n) => Deno.env.get(n)),
          paystackMode: Deno.env.get("PAYSTACK_SECRET_KEY")?.startsWith("sk_live_") ? "live" : Deno.env.get("PAYSTACK_SECRET_KEY") ? "test" : "not_configured",
          failedJobs: { automationRuns: automationRuns.data ?? [], contentPosts: posts.data ?? [], billingWebhooks: webhooks.data ?? [] },
          whatsappWebhookEvents7d: whatsappEvents,
        });
      }

      case "audit_log": {
        const [adminRows, operatorRows] = await Promise.all([
          sb.from("platform_admin_audit").select("id, operator_user_id, action, target_type, target_id, workspace_id, reason, created_at, profiles(full_name)").order("created_at", { ascending: false }).limit(PAGE),
          sb.from("platform_operator_actions").select("id, operator_user_id, workspace_id, action, reason, created_at, profiles(full_name)").order("created_at", { ascending: false }).limit(PAGE),
        ]);
        return json(req, { ok: true, admin: adminRows.data ?? [], workspaceActions: operatorRows.data ?? [] });
      }

      default:
        return json(req, { error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("operator-admin failed", action, e instanceof Error ? e.message : e);
    return json(req, { error: "Request failed" }, 500);
  }
});
