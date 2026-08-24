import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getObjectiveRule, isCtaAllowed, isDestinationTypeAllowed, isSupportedObjective, listObjectiveRules, SUPPORTED_OBJECTIVES } from "./adObjectiveRules.ts";

Deno.test("exactly the four documented objectives are supported", () => {
  assertEquals(SUPPORTED_OBJECTIVES.sort(), ["OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT", "OUTCOME_SALES", "OUTCOME_TRAFFIC"].sort());
});

Deno.test("OUTCOME_LEADS and OUTCOME_APP_PROMOTION are deliberately NOT supported this phase", () => {
  assertEquals(isSupportedObjective("OUTCOME_LEADS"), false);
  assertEquals(isSupportedObjective("OUTCOME_APP_PROMOTION"), false);
});

Deno.test("pre-ODAX legacy objectives are rejected outright", () => {
  assertEquals(isSupportedObjective("LINK_CLICKS"), false);
  assertEquals(isSupportedObjective("PAGE_LIKES"), false);
  assertEquals(isSupportedObjective("CONVERSIONS"), false);
});

Deno.test("getObjectiveRule returns null for an unsupported objective, not a default rule", () => {
  assertEquals(getObjectiveRule("OUTCOME_LEADS"), null);
});

Deno.test("every supported objective has a non-empty optimization_goal, billing_event, and at least one allowed CTA", () => {
  for (const rule of listObjectiveRules()) {
    assertEquals(typeof rule.optimizationGoal, "string");
    assertEquals(rule.optimizationGoal.length > 0, true);
    assertEquals(typeof rule.billingEvent, "string");
    assertEquals(rule.allowedCtas.length > 0, true);
    assertEquals(rule.allowedDestinationTypes.length > 0, true);
  }
});

Deno.test("OUTCOME_ENGAGEMENT does not allow a website destination (no destination_url without a page/profile target)", () => {
  assertEquals(isDestinationTypeAllowed("OUTCOME_ENGAGEMENT", "website"), false);
  assertEquals(isDestinationTypeAllowed("OUTCOME_ENGAGEMENT", "page_profile"), true);
});

Deno.test("OUTCOME_TRAFFIC allows both website and whatsapp destinations", () => {
  assertEquals(isDestinationTypeAllowed("OUTCOME_TRAFFIC", "website"), true);
  assertEquals(isDestinationTypeAllowed("OUTCOME_TRAFFIC", "whatsapp"), true);
});

Deno.test("isCtaAllowed rejects a CTA outside the objective's allowed list", () => {
  assertEquals(isCtaAllowed("OUTCOME_SALES", "DONATE_NOW"), false);
  assertEquals(isCtaAllowed("OUTCOME_SALES", "SHOP_NOW"), true);
});

Deno.test("isDestinationTypeAllowed / isCtaAllowed are false (not throwing) for an unsupported objective", () => {
  assertEquals(isDestinationTypeAllowed("OUTCOME_LEADS", "website"), false);
  assertEquals(isCtaAllowed("OUTCOME_LEADS", "LEARN_MORE"), false);
});
