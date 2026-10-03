// Phase D. Proves WhatsApp message processing against the REAL deployed
// whatsapp-webhook edge function - dedup, conversation upsert, ad-referral
// attribution capture, human-handoff phrase detection, and graceful
// no-auto-reply behavior when no real Meta/OpenAI credentials are
// configured (this dev project has no real Meta App - instruction #28 -
// so every "reply attempt" here exercises the SEND failure path, not a
// successful Meta delivery; that failure is caught and recorded, never
// left to crash the webhook).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, getTestEnv, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedWhatsAppSetup } from "./inboxHelpers";

const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

function textMessagePayload(phoneNumberId: string, messageId: string, text: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-test", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: "27820000099", profile: { name: "Test Customer" } }],
      messages: [{ from: "27820000099", id: messageId, type: "text", text: { body: text }, ...extra }],
    } }] }],
  });
}

async function postWebhook(body: string) {
  const res = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": await sign(body) }, body });
  return { status: res.status, text: await res.text() };
}

describe("Inbox webhook message processing (release blocker)", () => {
  let workspace: TestTenant;
  let number: { id: string; phone_number_id: string };

  beforeAll(async () => {
    workspace = await createTestTenant("inbox-webhook");
    number = await seedWhatsAppSetup(workspace.workspaceId);
    await admin.rpc("set_workspace_integration_secret", {
      p_integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", number.id).single()).data!.integration_id,
      p_secret: "mock-whatsapp-token-not-a-real-credential",
    });
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
  });

  it("a plain text message creates a conversation and stores the inbound message", async () => {
    const messageId = `wamid.plain-${Date.now()}`;
    const result = await postWebhook(textMessagePayload(number.phone_number_id, messageId, "What services do you offer?"));
    expect(result.status).toBe(200);

    const { data: conversation } = await admin.from("inbox_conversations").select("id, display_name, workspace_id").eq("whatsapp_number_id", number.id).eq("wa_id", "27820000099").single();
    expect(conversation!.workspace_id).toBe(workspace.workspaceId);
    expect(conversation!.display_name).toBe("Test Customer");

    const { data: message } = await admin.from("inbox_messages").select("content, direction, sender_type").eq("provider_message_id", messageId).single();
    expect(message!.content).toBe("What services do you offer?");
    expect(message!.direction).toBe("inbound");
    expect(message!.sender_type).toBe("customer");
  });

  it("REGRESSION: a duplicate delivery of the same message id is a safe no-op - exactly one row ever exists", async () => {
    const messageId = `wamid.dup-${Date.now()}`;
    const body = textMessagePayload(number.phone_number_id, messageId, "Duplicate test");
    await postWebhook(body);
    const second = await postWebhook(body);
    expect(second.status).toBe(200);

    const { data } = await admin.from("inbox_messages").select("id").eq("provider_message_id", messageId);
    expect(data).toHaveLength(1);
  });

  it("captures click-to-WhatsApp ad referral metadata onto the conversation - the future Campaign attribution hook", async () => {
    const messageId = `wamid.referral-${Date.now()}`;
    await postWebhook(textMessagePayload(number.phone_number_id, messageId, "Saw your ad", {
      referral: { source_type: "ad", source_id: "ad-123", headline: "Spring sale", ctwa_clid: "clid-xyz" },
    }));

    // referral_campaign_id was Phase D's original (buggy) column name for
    // this field - ctwa_clid is Meta's opaque per-CLICK id, not a campaign
    // id (Meta's real referral payload never includes a campaign id at
    // all). Phase G renamed it to referral_click_id to match its true
    // meaning; the deterministic campaign/ad_set/creative chain, when
    // resolvable, now lives in attribution_events (see
    // attribution-and-revenue.test.ts), not on this column.
    const { data: conversation } = await admin.from("inbox_conversations").select("referral_source, referral_ad_id, referral_headline, referral_click_id").eq("whatsapp_number_id", number.id).eq("wa_id", "27820000099").single();
    expect(conversation!.referral_source).toBe("ad");
    expect(conversation!.referral_ad_id).toBe("ad-123");
    expect(conversation!.referral_headline).toBe("Spring sale");
    expect(conversation!.referral_click_id).toBe("clid-xyz");
  });

  it("a human-handoff phrase flips the conversation to human_handoff with AI disabled, and stores a system message even though the (mock) send itself fails", async () => {
    const messageId = `wamid.handoff-${Date.now()}`;
    await postWebhook(textMessagePayload(number.phone_number_id, messageId, "Can I please speak to a human"));

    const { data: conversation } = await admin.from("inbox_conversations").select("id, status, ai_enabled, human_handoff_requested_at").eq("whatsapp_number_id", number.id).eq("wa_id", "27820000099").single();
    expect(conversation!.status).toBe("human_handoff");
    expect(conversation!.ai_enabled).toBe(false);
    expect(conversation!.human_handoff_requested_at).toBeTruthy();

    const { data: systemMessage } = await admin.from("inbox_messages").select("sender_type, direction, delivery_status").eq("conversation_id", conversation!.id).eq("sender_type", "system").order("created_at", { ascending: false }).limit(1).single();
    expect(systemMessage!.direction).toBe("outbound");
    expect(["failed", "submitted"]).toContain(systemMessage!.delivery_status); // "submitted" only if Meta somehow accepted a mock token, which it never does in practice - "failed" is the expected real outcome
  });

  it("REGRESSION: no OPENAI_API_KEY configured means the webhook does not crash and simply leaves the message for staff (no auto-reply attempted)", async () => {
    // A fresh, non-greeting, non-handoff-phrase message on a fresh conversation with AI still enabled.
    const freshNumber = await seedWhatsAppSetup(workspace.workspaceId, { phone_number_id: `phone-fresh-${Date.now()}` });
    const messageId = `wamid.aiskip-${Date.now()}`;
    const result = await postWebhook(textMessagePayload(freshNumber.phone_number_id, messageId, "Tell me more about your pricing tiers please"));
    expect(result.status).toBe(200); // never a 500, regardless of AI configuration

    const { data: conversation } = await admin.from("inbox_conversations").select("id, ai_enabled, status").eq("whatsapp_number_id", freshNumber.id).eq("wa_id", "27820000099").single();
    expect(conversation!.ai_enabled).toBe(true);
    expect(conversation!.status).toBe("active");

    const { data: messages } = await admin.from("inbox_messages").select("direction").eq("conversation_id", conversation!.id);
    expect(messages!.every((m) => m.direction === "inbound")).toBe(true); // no outbound reply was ever attempted
  });

  it("an inactive WhatsApp number is a safe no-op - no conversation is created", async () => {
    const inactiveNumber = await seedWhatsAppSetup(workspace.workspaceId, { phone_number_id: `phone-inactive-${Date.now()}`, is_active: false });
    const messageId = `wamid.inactive-${Date.now()}`;
    const result = await postWebhook(textMessagePayload(inactiveNumber.phone_number_id, messageId, "Hello?"));
    expect(result.status).toBe(200);

    const { data } = await admin.from("inbox_conversations").select("id").eq("whatsapp_number_id", inactiveNumber.id);
    expect(data).toEqual([]);
  });

  it("an unrecognised phone_number_id is a safe no-op, not an error", async () => {
    const messageId = `wamid.unknown-${Date.now()}`;
    const result = await postWebhook(textMessagePayload("phone-number-id-that-does-not-exist", messageId, "Hello?"));
    expect(result.status).toBe(200);
    const { data } = await admin.from("inbox_messages").select("id").eq("provider_message_id", messageId);
    expect(data).toEqual([]);
  });
});
