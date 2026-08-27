import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateConditions } from "./conditionEvaluator.ts";

Deno.test("evaluateConditions passes when there are no conditions at all", () => {
  const { allPassed } = evaluateConditions([], { source: "whatsapp" });
  assertEquals(allPassed, true);
});

Deno.test("evaluateConditions ANDs multiple conditions - all must pass", () => {
  const conditions = [{ field: "source", operator: "eq", value: "whatsapp" }, { field: "qualification_status", operator: "eq", value: "qualified" }];
  assertEquals(evaluateConditions(conditions, { source: "whatsapp", qualification_status: "qualified" }).allPassed, true);
  assertEquals(evaluateConditions(conditions, { source: "whatsapp", qualification_status: "unqualified" }).allPassed, false);
});

Deno.test("evaluateConditions supports dotted field paths into nested payload objects", () => {
  const conditions = [{ field: "lead.source", operator: "eq", value: "meta" }];
  assertEquals(evaluateConditions(conditions, { lead: { source: "meta" } }).allPassed, true);
});

Deno.test("evaluateConditions numeric operators", () => {
  assertEquals(evaluateConditions([{ field: "amount", operator: "gt", value: 100 }], { amount: 150 }).allPassed, true);
  assertEquals(evaluateConditions([{ field: "amount", operator: "gt", value: 100 }], { amount: 50 }).allPassed, false);
  assertEquals(evaluateConditions([{ field: "amount", operator: "gte", value: 100 }], { amount: 100 }).allPassed, true);
});

Deno.test("evaluateConditions in/not_in against an array of allowed values", () => {
  assertEquals(evaluateConditions([{ field: "status", operator: "in", value: ["won", "open"] }], { status: "won" }).allPassed, true);
  assertEquals(evaluateConditions([{ field: "status", operator: "not_in", value: ["lost"] }], { status: "won" }).allPassed, true);
  assertEquals(evaluateConditions([{ field: "status", operator: "not_in", value: ["lost"] }], { status: "lost" }).allPassed, false);
});

Deno.test("evaluateConditions is_null / is_not_null", () => {
  assertEquals(evaluateConditions([{ field: "assigned_to", operator: "is_null", value: null }], {}).allPassed, true);
  assertEquals(evaluateConditions([{ field: "assigned_to", operator: "is_not_null", value: null }], { assigned_to: "user-1" }).allPassed, true);
});

Deno.test("evaluateConditions fails closed on an unrecognized operator rather than matching everything", () => {
  const result = evaluateConditions([{ field: "x", operator: "not_a_real_operator", value: 1 }], { x: 1 });
  assertEquals(result.allPassed, false);
});

Deno.test("evaluateConditions records a per-condition result for observability (automation_runs.conditions_result)", () => {
  const { results } = evaluateConditions([{ field: "source", operator: "eq", value: "whatsapp" }], { source: "meta" });
  assertEquals(results, [{ field: "source", operator: "eq", expected: "whatsapp", actual: "meta", passed: false }]);
});
