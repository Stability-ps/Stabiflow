import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  reasonOf, secretStatus, validateFlagUpdate, validateOverride, validatePlan, validatePlanEntitlement, validatePrice, validatePriceUpdate,
  validateSettingUpdate,
} from "./adminValidation.ts";

const PLAN = "11111111-1111-4111-8111-111111111111";

Deno.test("validatePlan normalises marketing copy and rejects bad codes/kinds", () => {
  const ok = validatePlan({ code: "business", name: " Business ", plan_kind: "subscription", marketing: { features: ["A", "", 3, "B"], cta: "Go" } });
  assertEquals(ok.ok && ok.value.name, "Business");
  assertEquals(ok.ok && ok.value.marketing.features, ["A", "B"]);
  assertEquals(validatePlan({ code: "Bad Code", name: "x", plan_kind: "subscription" }).ok, false);
  assertEquals(validatePlan({ code: "ok", name: "x", plan_kind: "lifetime" }).ok, false);
});

Deno.test("validatePrice enforces cents, interval, currency, access-days and plan-code rules", () => {
  assertEquals(validatePrice({ plan_id: PLAN, amount_minor: 24900, billing_interval: "month", currency: "zar" }).ok, true);
  assertEquals(validatePrice({ plan_id: PLAN, amount_minor: 249.5, billing_interval: "month" }).ok, false);
  assertEquals(validatePrice({ plan_id: PLAN, amount_minor: -1, billing_interval: "month" }).ok, false);
  assertEquals(validatePrice({ plan_id: PLAN, amount_minor: 100, billing_interval: "weekly" }).ok, false);
  assertEquals(validatePrice({ plan_id: PLAN, amount_minor: 100, billing_interval: "month", access_days: 30 }).ok, false);
  assertEquals(validatePrice({ plan_id: PLAN, amount_minor: 100, billing_interval: "once", access_days: 365 }).ok, true);
  assertEquals(validatePrice({ plan_id: PLAN, amount_minor: 100, billing_interval: "once", paystack_plan_code: "PLN_abc" }).ok, false);
  assertEquals(validatePrice({ plan_id: PLAN, amount_minor: 100, billing_interval: "month", paystack_plan_code: "nope" }).ok, false);
  assertEquals(validatePrice({ plan_id: "x", amount_minor: 100, billing_interval: "month" }).ok, false);
});

Deno.test("validatePriceUpdate refuses amount changes (prices are immutable)", () => {
  assertEquals(validatePriceUpdate({ amount_minor: 1 }).ok, false);
  assertEquals(validatePriceUpdate({ is_active: false }).ok, true);
  assertEquals(validatePriceUpdate({ paystack_plan_code: "PLN_x1" }).ok, true);
  assertEquals(validatePriceUpdate({ paystack_plan_code: "" }), { ok: true, value: { paystack_plan_code: null } });
});

Deno.test("validatePlanEntitlement: empty limit means unlimited, non-integer limit rejected", () => {
  const r = validatePlanEntitlement({ plan_id: PLAN, entitlement_key: "website_scans", limit_value: "" });
  assertEquals(r.ok && r.value.limit_value, null);
  assertEquals(validatePlanEntitlement({ plan_id: PLAN, entitlement_key: "website_scans", limit_value: "ten" }).ok, false);
  assertEquals(validatePlanEntitlement({ plan_id: PLAN, entitlement_key: "website_scans", limit_value: -1 }).ok, false);
});

Deno.test("validateFlagUpdate bounds rollout and validates audience/plan codes", () => {
  assertEquals(validateFlagUpdate({ rollout_percentage: 101 }).ok, false);
  assertEquals(validateFlagUpdate({ audience: "admins" }).ok, false);
  assertEquals(validateFlagUpdate({ plan_codes: ["business", "business", "growth"] }), { ok: true, value: { plan_codes: ["business", "growth"] } });
  assertEquals(validateFlagUpdate({}).ok, false);
});

Deno.test("validateSettingUpdate refuses anything that looks like a secret", () => {
  assertEquals(validateSettingUpdate({ key: "paystack.secret_key", value: "sk_live" }).ok, false);
  assertEquals(validateSettingUpdate({ key: "openai.api_key", value: "x" }).ok, false);
  assertEquals(validateSettingUpdate({ key: "support.contact", value: { email: "help@example.com" } }).ok, true);
  assertEquals(validateSettingUpdate({ key: "content.faq" }).ok, false);
});

Deno.test("validateOverride requires a future expiry when given", () => {
  assertEquals(validateOverride({ workspace_id: PLAN, entitlement_key: "hosted_profile.publish", bool_value: true, expires_at: "2000-01-01" }).ok, false);
  assertEquals(validateOverride({ workspace_id: PLAN, entitlement_key: "hosted_profile.publish", bool_value: true }).ok, true);
});

Deno.test("reasonOf requires a meaningful reason", () => {
  assertEquals(reasonOf("").ok, false);
  assertEquals(reasonOf("ok").ok, false);
  assertEquals(reasonOf("pilot customer").ok, true);
});

Deno.test("secretStatus reports configured/missing only - never the value", () => {
  const rows = secretStatus((n) => (n === "PAYSTACK_SECRET_KEY" ? "sk_live_supersecret" : undefined));
  const paystack = rows.find((r) => r.name === "PAYSTACK_SECRET_KEY")!;
  assertEquals(paystack.configured, true);
  assertEquals(JSON.stringify(rows).includes("supersecret"), false);
  assertEquals(rows.find((r) => r.name === "OPENAI_API_KEY")?.configured, false);
});
