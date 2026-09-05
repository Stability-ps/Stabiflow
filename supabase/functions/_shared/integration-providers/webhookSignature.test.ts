import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyMetaWebhookSignature, verifyWebhookChallenge } from "./webhookSignature.ts";

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

Deno.test("a correctly-signed body verifies", async () => {
  const secret = "test-app-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const header = await sign(secret, body);
  assertEquals(await verifyMetaWebhookSignature(secret, body, header), true);
});

Deno.test("REGRESSION: a body signed with the WRONG secret is rejected", async () => {
  const body = JSON.stringify({ hello: "world" });
  const header = await sign("someone-elses-app-secret", body);
  assertEquals(await verifyMetaWebhookSignature("test-app-secret", body, header), false);
});

Deno.test("a tampered body (signature computed over different bytes) is rejected - proves the signature covers the RAW body, not a re-serialized one", async () => {
  const secret = "test-app-secret";
  const originalBody = JSON.stringify({ amount: 10 });
  const header = await sign(secret, originalBody);
  const tamperedBody = JSON.stringify({ amount: 10000 });
  assertEquals(await verifyMetaWebhookSignature(secret, tamperedBody, header), false);
});

Deno.test("missing signature header is rejected, not treated as valid", async () => {
  assertEquals(await verifyMetaWebhookSignature("secret", "{}", null), false);
});

Deno.test("a header without the sha256= prefix is rejected", async () => {
  assertEquals(await verifyMetaWebhookSignature("secret", "{}", "deadbeef"), false);
});

Deno.test("verifyWebhookChallenge echoes the challenge only when mode=subscribe and the verify token matches", () => {
  const result = verifyWebhookChallenge({ mode: "subscribe", verifyToken: "shared-secret", expectedVerifyToken: "shared-secret", challenge: "12345" });
  assertEquals(result, "12345");
});

Deno.test("REGRESSION: verifyWebhookChallenge rejects a wrong verify token even with mode=subscribe", () => {
  const result = verifyWebhookChallenge({ mode: "subscribe", verifyToken: "guessed-token", expectedVerifyToken: "shared-secret", challenge: "12345" });
  assertEquals(result, null);
});

Deno.test("verifyWebhookChallenge rejects a mode other than subscribe even with the correct token", () => {
  const result = verifyWebhookChallenge({ mode: "unsubscribe", verifyToken: "shared-secret", expectedVerifyToken: "shared-secret", challenge: "12345" });
  assertEquals(result, null);
});
