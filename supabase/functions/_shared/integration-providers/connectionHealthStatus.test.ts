import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { summarizeStatus } from "./connectionHealthStatus.ts";

Deno.test("an unhealthy token always reports reauthorization_required, regardless of resource state", () => {
  const result = summarizeStatus(false, true, null);
  assertEquals(result.status, "reauthorization_required");
});

Deno.test("REGRESSION: a healthy token with zero selected resources does NOT report healthy - an empty array trivially passes 'every resource is healthy'", () => {
  const result = summarizeStatus(true, true, "No WhatsApp phone numbers found. Refresh resources or connect a number in your WhatsApp Business Account.");
  assertEquals(result.status, "needs_attention");
  assertEquals(result.message, "No WhatsApp phone numbers found. Refresh resources or connect a number in your WhatsApp Business Account.");
});

Deno.test("a healthy token with at least one resource, all healthy, reports healthy", () => {
  const result = summarizeStatus(true, true, null);
  assertEquals(result.status, "healthy");
});

Deno.test("a healthy token with at least one unhealthy resource reports needs_attention", () => {
  const result = summarizeStatus(true, false, null);
  assertEquals(result.status, "needs_attention");
});

Deno.test("an unhealthy token takes priority over an empty-resources message - reconnecting fixes both at once", () => {
  const result = summarizeStatus(false, false, "No WhatsApp phone numbers found. Refresh resources or connect a number in your WhatsApp Business Account.");
  assertEquals(result.status, "reauthorization_required");
});
