import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateRetryGates, type RetryGateInput } from "./outboundRetryWorker.ts";

const OK: RetryGateInput = {
  messageType: "text",
  workspaceActive: true,
  hasCredential: true,
  windowOpen: true,
  templateEligible: null,
  templateErrorCode: null,
};

Deno.test("evaluateRetryGates: all gates pass -> proceed", () => {
  assertEquals(evaluateRetryGates(OK), { proceed: true });
});

Deno.test("evaluateRetryGates: suspended workspace -> policy_blocked workspace_suspended", () => {
  const d = evaluateRetryGates({ ...OK, workspaceActive: false });
  assertEquals(d.proceed, false);
  if (!d.proceed) assertEquals(d.code, "workspace_suspended");
});

Deno.test("evaluateRetryGates: no credential -> policy_blocked credential_unavailable", () => {
  const d = evaluateRetryGates({ ...OK, hasCredential: false });
  assertEquals(d.proceed, false);
  if (!d.proceed) assertEquals(d.code, "credential_unavailable");
});

Deno.test("evaluateRetryGates: free-form retry with a closed 24h window does NOT proceed", () => {
  const d = evaluateRetryGates({ ...OK, windowOpen: false });
  assertEquals(d.proceed, false);
  if (!d.proceed) assertEquals(d.code, "messaging_window_closed");
});

Deno.test("evaluateRetryGates: template retry ignores the messaging window", () => {
  const d = evaluateRetryGates({ ...OK, messageType: "template", windowOpen: false, templateEligible: true });
  assertEquals(d, { proceed: true });
});

Deno.test("evaluateRetryGates: template no longer APPROVED -> policy_blocked with the template code", () => {
  const d = evaluateRetryGates({ ...OK, messageType: "template", templateEligible: false, templateErrorCode: "template_not_approved" });
  assertEquals(d.proceed, false);
  if (!d.proceed) assertEquals(d.code, "template_not_approved");
});

Deno.test("evaluateRetryGates: template eligibility unknown (null) is treated as ineligible", () => {
  const d = evaluateRetryGates({ ...OK, messageType: "template", templateEligible: null, templateErrorCode: null });
  assertEquals(d.proceed, false);
  if (!d.proceed) assertEquals(d.code, "template_ineligible");
});
