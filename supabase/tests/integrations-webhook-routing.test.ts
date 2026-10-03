// Phase C instruction #41. Proves the WhatsApp webhook ROUTING foundation
// against the REAL deployed whatsapp-webhook edge function - no message
// content is ever processed or replied to (instruction #43); this only
// proves phone_number_id -> workspace resolution, idempotent dedup, safe
// no-op for an unknown number, and signature rejection.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, getTestEnv, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedWhatsAppNumber, seedWorkspaceIntegration } from "./integrationHelpers";

const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");
const VERIFY_TOKEN = getTestEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

function messagePayload(phoneNumberId: string, messageId: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-test",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              messages: [{ id: messageId, from: "27820000000", type: "text" }],
            },
          },
        ],
      },
    ],
  });
}

async function postWebhook(body: string, signatureOverride?: string) {
  const signature = signatureOverride !== undefined ? signatureOverride : await sign(body);
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-signature-256": signature },
    body,
  });
  return { status: res.status, text: await res.text() };
}

describe("WhatsApp webhook verification handshake (release blocker)", () => {
  it("echoes the challenge for a correct verify token", async () => {
    const url = new URL(WEBHOOK_URL);
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", VERIFY_TOKEN);
    url.searchParams.set("hub.challenge", "challenge-12345");
    const res = await fetch(url.toString());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("challenge-12345");
  });

  it("REGRESSION: rejects a wrong verify token, even with mode=subscribe and a valid-looking challenge", async () => {
    const url = new URL(WEBHOOK_URL);
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", "guessed-wrong-token");
    url.searchParams.set("hub.challenge", "challenge-12345");
    const res = await fetch(url.toString());
    expect(res.status).toBe(403);
  });
});

describe("WhatsApp webhook routing (release blocker)", () => {
  let workspaceA: TestTenant;
  let workspaceB: TestTenant;
  let numberA: { id: string; phone_number_id: string };

  beforeAll(async () => {
    workspaceA = await createTestTenant("wh-routing-a");
    workspaceB = await createTestTenant("wh-routing-b");
    const integrationA = await seedWorkspaceIntegration(workspaceA.workspaceId);
    const integrationB = await seedWorkspaceIntegration(workspaceB.workspaceId);
    numberA = await seedWhatsAppNumber(workspaceA.workspaceId, integrationA);
    // A second workspace with its OWN registered number - present so the
    // routing test below proves workspace A's number resolves ONLY to
    // workspace A, not merely "some workspace" in a single-tenant setup.
    await seedWhatsAppNumber(workspaceB.workspaceId, integrationB);
  });

  afterAll(async () => {
    await cleanupTenant(workspaceA);
    await cleanupTenant(workspaceB);
  });

  it("a signature computed with the WRONG secret is rejected with 403, and no event row is recorded", async () => {
    const messageId = `wamid.reject-${Date.now()}`;
    const body = messagePayload(numberA.phone_number_id, messageId);
    const wrongKey = await crypto.subtle.importKey("raw", new TextEncoder().encode("wrong-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const wrongSig = await crypto.subtle.sign("HMAC", wrongKey, new TextEncoder().encode(body));
    const wrongHex = "sha256=" + [...new Uint8Array(wrongSig)].map((b) => b.toString(16).padStart(2, "0")).join("");

    const result = await postWebhook(body, wrongHex);
    expect(result.status).toBe(403);

    const { data } = await admin.from("workspace_whatsapp_webhook_events").select("id").eq("provider_event_id", messageId);
    expect(data).toEqual([]);
  });

  it("a KNOWN phone_number_id resolves to EXACTLY the workspace that owns it - never the other workspace", async () => {
    const messageId = `wamid.route-a-${Date.now()}`;
    const body = messagePayload(numberA.phone_number_id, messageId);
    const result = await postWebhook(body);
    expect(result.status).toBe(200);

    const { data } = await admin.from("workspace_whatsapp_webhook_events").select("workspace_id").eq("provider_event_id", messageId).single();
    expect(data!.workspace_id).toBe(workspaceA.workspaceId);
    expect(data!.workspace_id).not.toBe(workspaceB.workspaceId);
  });

  it("an UNKNOWN phone_number_id is safely no-op'd - 200 OK, event recorded with a null workspace_id, nothing crashes", async () => {
    const messageId = `wamid.unknown-${Date.now()}`;
    const body = messagePayload("phone-number-id-that-does-not-exist", messageId);
    const result = await postWebhook(body);
    expect(result.status).toBe(200);

    const { data } = await admin.from("workspace_whatsapp_webhook_events").select("workspace_id").eq("provider_event_id", messageId).single();
    expect(data!.workspace_id).toBeNull();
  });

  it("REGRESSION: a duplicate delivery of the SAME event id is a safe no-op - exactly one row ever exists for it, never processed twice", async () => {
    const messageId = `wamid.dup-${Date.now()}`;
    const body = messagePayload(numberA.phone_number_id, messageId);

    const first = await postWebhook(body);
    expect(first.status).toBe(200);
    const second = await postWebhook(body); // exact same delivery, replayed
    expect(second.status).toBe(200); // still acked 200 - Meta must not see this as a failure worth retrying differently

    const { data } = await admin.from("workspace_whatsapp_webhook_events").select("id").eq("provider_event_id", messageId);
    expect(data).toHaveLength(1);
  });

  it("two truly concurrent deliveries of the same event id still only ever produce one row (unique constraint under real concurrency, not just sequential calls)", async () => {
    const messageId = `wamid.concurrent-${Date.now()}`;
    const body = messagePayload(numberA.phone_number_id, messageId);
    await Promise.all([postWebhook(body), postWebhook(body)]);
    const { data } = await admin.from("workspace_whatsapp_webhook_events").select("id").eq("provider_event_id", messageId);
    expect(data).toHaveLength(1);
  });
});
