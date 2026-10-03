import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isBlockedWhatsAppMockSend, resolveWhatsAppSendMockMode, REAL_WHATSAPP_PROVIDER } from "./whatsappSendProvider.ts";

const HARNESS_SECRET = "test-harness-secret-value";

function reqWith(headers: Record<string, string> = {}): Request {
  return new Request("https://example.functions.supabase.co/inbox-actions", { method: "POST", headers });
}

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    run();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("REGRESSION (W1): mock send mode is NEVER selected for a real caller, even with INTEGRATIONS_META_MOCK_MODE=true - a production send can't be silently faked", () => {
  withEnv({ INTEGRATIONS_META_MOCK_MODE: "true", INTEGRATIONS_TEST_HARNESS_SECRET: HARNESS_SECRET }, () => {
    // A genuine browser/Meta request carries no test-harness header.
    assertEquals(resolveWhatsAppSendMockMode(reqWith()), false);
    assertEquals(isBlockedWhatsAppMockSend(reqWith()), true);
  });
});

Deno.test("W1: mock send mode requires BOTH the env flag AND the correct per-request harness secret", () => {
  withEnv({ INTEGRATIONS_META_MOCK_MODE: "true", INTEGRATIONS_TEST_HARNESS_SECRET: HARNESS_SECRET }, () => {
    assertEquals(resolveWhatsAppSendMockMode(reqWith({ "x-stabiflow-test-harness": HARNESS_SECRET })), true);
    assertEquals(isBlockedWhatsAppMockSend(reqWith({ "x-stabiflow-test-harness": HARNESS_SECRET })), false);
    // Wrong secret is treated exactly like no secret.
    assertEquals(resolveWhatsAppSendMockMode(reqWith({ "x-stabiflow-test-harness": "not-the-secret" })), false);
  });
});

Deno.test("W1: with the env flag OFF, the harness header alone can never enable the mock send provider", () => {
  withEnv({ INTEGRATIONS_META_MOCK_MODE: undefined, INTEGRATIONS_TEST_HARNESS_SECRET: HARNESS_SECRET }, () => {
    assertEquals(resolveWhatsAppSendMockMode(reqWith({ "x-stabiflow-test-harness": HARNESS_SECRET })), false);
    assertEquals(isBlockedWhatsAppMockSend(reqWith({ "x-stabiflow-test-harness": HARNESS_SECRET })), false);
  });
});

Deno.test("W1: when INTEGRATIONS_TEST_HARNESS_SECRET is unset (normal production), mock send mode is unreachable", () => {
  withEnv({ INTEGRATIONS_META_MOCK_MODE: "true", INTEGRATIONS_TEST_HARNESS_SECRET: undefined }, () => {
    assertEquals(resolveWhatsAppSendMockMode(reqWith({ "x-stabiflow-test-harness": "anything" })), false);
    assertEquals(isBlockedWhatsAppMockSend(reqWith()), true);
  });
});

Deno.test("W1: the real provider is a distinct object and always available regardless of env", () => {
  assertEquals(typeof REAL_WHATSAPP_PROVIDER.sendText, "function");
  assertEquals(typeof REAL_WHATSAPP_PROVIDER.sendTemplate, "function");
});
