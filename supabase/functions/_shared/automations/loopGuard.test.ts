import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkLoopGuard, MAX_CAUSATION_DEPTH } from "./loopGuard.ts";

Deno.test("allows a normal, non-automation-caused event to trigger any automation", () => {
  const result = checkLoopGuard({ eventCausedByAutomationId: null, eventCausationDepth: 0 }, "automation-a");
  assertEquals(result.allowed, true);
});

Deno.test("REGRESSION: refuses a direct cycle - an automation's own action re-triggering itself", () => {
  const result = checkLoopGuard({ eventCausedByAutomationId: "automation-a", eventCausationDepth: 1 }, "automation-a");
  assertEquals(result.allowed, false);
});

Deno.test("allows automation A's action to trigger a DIFFERENT automation B", () => {
  const result = checkLoopGuard({ eventCausedByAutomationId: "automation-a", eventCausationDepth: 1 }, "automation-b");
  assertEquals(result.allowed, true);
});

Deno.test("refuses once causation depth reaches the maximum, even without a single repeated automation id (A -> B -> C -> ... chain)", () => {
  const result = checkLoopGuard({ eventCausedByAutomationId: "automation-z", eventCausationDepth: MAX_CAUSATION_DEPTH }, "automation-new");
  assertEquals(result.allowed, false);
});

Deno.test("allows a chain just below the depth limit", () => {
  const result = checkLoopGuard({ eventCausedByAutomationId: "automation-z", eventCausationDepth: MAX_CAUSATION_DEPTH - 1 }, "automation-new");
  assertEquals(result.allowed, true);
});
