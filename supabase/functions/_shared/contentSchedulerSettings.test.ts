import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeEffectiveAutoPublish, decideSetAutoPublish } from "./contentSchedulerSettings.ts";

Deno.test("env false + workspace false => publishing not allowed", () => {
  assertEquals(computeEffectiveAutoPublish(false, false), false);
});

Deno.test("env false + workspace true => publishing not allowed (env kill switch wins)", () => {
  assertEquals(computeEffectiveAutoPublish(false, true), false);
});

Deno.test("env true + workspace false => publishing not allowed (workspace switch is off)", () => {
  assertEquals(computeEffectiveAutoPublish(true, false), false);
});

Deno.test("env true + workspace true => publishing allowed", () => {
  assertEquals(computeEffectiveAutoPublish(true, true), true);
});

// --- decideSetAutoPublish ----------------------------------------------

Deno.test("REGRESSION: a non-workspace-admin caller is refused regardless of the requested value", () => {
  assertEquals(decideSetAutoPublish({ isWorkspaceAdmin: false, currentEnabled: false, requestedEnabled: true }), { action: "forbidden" });
  assertEquals(decideSetAutoPublish({ isWorkspaceAdmin: false, currentEnabled: true, requestedEnabled: false }), { action: "forbidden" });
});

Deno.test("workspace admin can enable: false -> true is an update", () => {
  assertEquals(decideSetAutoPublish({ isWorkspaceAdmin: true, currentEnabled: false, requestedEnabled: true }), { action: "update", enabled: true });
});

Deno.test("workspace admin can disable: true -> false is an update", () => {
  assertEquals(decideSetAutoPublish({ isWorkspaceAdmin: true, currentEnabled: true, requestedEnabled: false }), { action: "update", enabled: false });
});

Deno.test("REGRESSION: repeated enable request (true -> true) is idempotent - no_change, not another update", () => {
  assertEquals(decideSetAutoPublish({ isWorkspaceAdmin: true, currentEnabled: true, requestedEnabled: true }), { action: "no_change", enabled: true });
});

Deno.test("REGRESSION: repeated disable request (false -> false) is idempotent - no_change, not another update", () => {
  assertEquals(decideSetAutoPublish({ isWorkspaceAdmin: true, currentEnabled: false, requestedEnabled: false }), { action: "no_change", enabled: false });
});
