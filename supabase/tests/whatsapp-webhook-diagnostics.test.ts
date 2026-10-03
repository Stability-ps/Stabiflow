// Phase 15 - webhook outcome model + get_recent_whatsapp_webhook_events.
//
// Exercises the REAL local whatsapp-webhook edge function + the RPC.
// No provider calls (local runtime has no Meta/OpenAI creds, exactly like
// inbox-webhook-processing.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, getTestEnv, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedWhatsAppSetup } from "./inboxHelpers";

const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function post(body: string, signature?: string) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-signature-256": signature ?? (await sign(body)) },
    body,
  });
  return res.status;
}
function textPayload(phoneNumberId: string, messageId: string, text: string, waId = "27829990001") {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-d", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: waId, profile: { name: "Diag Tester" } }],
      messages: [{ from: waId, id: messageId, type: "text", text: { body: text } }],
    } }] }],
  });
}
/** A message with an id (so it routes) but no `from` - parseInboundMessageEvents skips it. */
function malformedMessagePayload(phoneNumberId: string, messageId: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-d", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      messages: [{ id: messageId, type: "text", text: { body: "no from field" } }],
    } }] }],
  });
}
async function ledgerRow(phoneNumberId: string, eventId: string) {
  const { data } = await admin.from("workspace_whatsapp_webhook_events")
    .select("workspace_id, event_type, payload_summary")
    .eq("phone_number_id", phoneNumberId).eq("provider_event_id", eventId).maybeSingle();
  return data;
}
async function rpc(client: SupabaseClient, workspaceId: string, limit = 10) {
  const { data, error } = await client.rpc("get_recent_whatsapp_webhook_events", { p_workspace_id: workspaceId, p_limit: limit });
  if (error) throw new Error(error.message);
  return data as Array<Record<string, unknown>>;
}

describe("Phase 15 - webhook outcome ledger", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let phoneNumberId: string;

  beforeAll(async () => {
    ws = await createTestTenant("wh-diag");
    other = await createTestTenant("wh-diag-other");
    const num = await seedWhatsAppSetup(ws.workspaceId);
    phoneNumberId = num.phone_number_id;
    await admin.rpc("set_workspace_integration_secret", {
      p_integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", num.id).single()).data!.integration_id,
      p_secret: "mock-whatsapp-token-not-a-real-credential",
    });
    await seedWhatsAppSetup(other.workspaceId);
  });
  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  it("a routed inbound message -> payload_summary.outcome = 'stored' + message_type, workspace_id set", async () => {
    const id = `wamid.stored-${Date.now()}`;
    expect(await post(textPayload(phoneNumberId, id, "hello there"))).toBe(200);
    const row = await ledgerRow(phoneNumberId, id);
    expect(row!.workspace_id).toBe(ws.workspaceId);
    expect((row!.payload_summary as Record<string, unknown>).outcome).toBe("stored");
    expect((row!.payload_summary as Record<string, unknown>).message_type).toBe("text");
    expect((row!.payload_summary as Record<string, unknown>).resolved).toBe(true);
  });

  it("an unknown phone_number_id -> outcome 'unresolved_number', workspace_id NULL, still HTTP 200", async () => {
    const id = `wamid.unres-${Date.now()}`;
    expect(await post(textPayload("pnid-does-not-exist", id, "hi"))).toBe(200);
    const row = await ledgerRow("pnid-does-not-exist", id);
    expect(row!.workspace_id).toBeNull();
    expect((row!.payload_summary as Record<string, unknown>).outcome).toBe("unresolved_number");
    expect((row!.payload_summary as Record<string, unknown>).resolved).toBe(false);
  });

  it("a duplicate delivery -> exactly one ledger row, still processed once", async () => {
    const id = `wamid.dup-${Date.now()}`;
    const body = textPayload(phoneNumberId, id, "dup body");
    expect(await post(body)).toBe(200);
    expect(await post(body)).toBe(200);
    const { data } = await admin.from("workspace_whatsapp_webhook_events").select("id").eq("phone_number_id", phoneNumberId).eq("provider_event_id", id);
    expect(data).toHaveLength(1);
    const { data: msgs } = await admin.from("inbox_messages").select("id").eq("provider_message_id", id);
    expect(msgs).toHaveLength(1);
  });

  it("a signed message with no `from` -> outcome 'ignored_unsupported' (routed, nothing stored)", async () => {
    const id = `wamid.malformed-${Date.now()}`;
    expect(await post(malformedMessagePayload(phoneNumberId, id))).toBe(200);
    const row = await ledgerRow(phoneNumberId, id);
    expect(row!.workspace_id).toBe(ws.workspaceId);
    expect((row!.payload_summary as Record<string, unknown>).outcome).toBe("ignored_unsupported");
  });

  it("a bad signature -> HTTP 403 and NO ledger row (untrusted body is never tenant-attributed)", async () => {
    const id = `wamid.badsig-${Date.now()}`;
    expect(await post(textPayload(phoneNumberId, id, "spoofed"), "sha256=deadbeef")).toBe(403);
    expect(await ledgerRow(phoneNumberId, id)).toBeNull();
  });

  it("payload_summary never contains message content or other PII", async () => {
    const id = `wamid.pii-${Date.now()}`;
    await post(textPayload(phoneNumberId, id, "my id number is 8001015009087 secret"));
    const row = await ledgerRow(phoneNumberId, id);
    const keys = Object.keys(row!.payload_summary as Record<string, unknown>).sort();
    expect(keys.every((k) => ["resolved", "outcome", "message_type"].includes(k))).toBe(true);
    expect(JSON.stringify(row!.payload_summary)).not.toContain("8001015009087");
    expect(JSON.stringify(row!.payload_summary)).not.toContain("secret");
  });

  it("workspace A cannot read workspace B's webhook_events rows directly (table RLS)", async () => {
    const id = `wamid.rls-${Date.now()}`;
    await post(textPayload(phoneNumberId, id, "b only"));
    const { data } = await other.client.from("workspace_whatsapp_webhook_events").select("id").eq("provider_event_id", id);
    expect(data ?? []).toEqual([]);
  });
});

describe("Phase 15 - get_recent_whatsapp_webhook_events", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let phoneNumberId: string;

  beforeAll(async () => {
    ws = await createTestTenant("wh-rpc");
    other = await createTestTenant("wh-rpc-other");
    const num = await seedWhatsAppSetup(ws.workspaceId);
    phoneNumberId = num.phone_number_id;
    await admin.rpc("set_workspace_integration_secret", {
      p_integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", num.id).single()).data!.integration_id,
      p_secret: "mock-whatsapp-token-not-a-real-credential",
    });
    await seedWhatsAppSetup(other.workspaceId);
    for (let i = 0; i < 4; i++) await post(textPayload(phoneNumberId, `wamid.rpc-${Date.now()}-${i}`, `m${i}`));
  });
  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  it("returns this workspace's recent events, newest first, with the diagnostic-safe columns", async () => {
    const rows = await rpc(ws.client, ws.workspaceId, 10);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["event_type", "id", "is_unresolved", "message_type", "outcome", "phone_number_id", "received_at", "resolved"]);
      expect(r.outcome).toBe("stored");
      expect(r.is_unresolved).toBe(false);
    }
    for (let i = 1; i < rows.length; i++) {
      expect(new Date(rows[i - 1].received_at as string).getTime() >= new Date(rows[i].received_at as string).getTime()).toBe(true);
    }
  });

  it("p_limit is clamped to 1..20", async () => {
    expect((await rpc(ws.client, ws.workspaceId, 0)).length).toBe(1);
    expect((await rpc(ws.client, ws.workspaceId, 9999)).length).toBeLessThanOrEqual(20);
  });

  it("workspace A cannot read workspace B's events via the RPC", async () => {
    await post(textPayload(phoneNumberId, `wamid.iso-${Date.now()}`, "ws only"));
    const rows = await rpc(other.client, other.workspaceId, 20);
    expect(rows.every((r) => r.phone_number_id !== phoneNumberId)).toBe(true);
    // and calling for A's workspace as B's user returns nothing
    expect(await rpc(other.client, ws.workspaceId, 20)).toEqual([]);
  });

  it("an unresolved (workspace_id NULL) event is surfaced ONLY to a workspace that owns that phone_number_id", async () => {
    // Seed an INACTIVE number for `ws` so a webhook to it routes to no
    // active number (workspace_id NULL) but is provably ws-owned.
    const inactivePid = `pnid-inactive-${Date.now()}`;
    await admin.from("workspace_whatsapp_numbers").insert({
      workspace_id: ws.workspaceId,
      integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("workspace_id", ws.workspaceId).limit(1).single()).data!.integration_id,
      phone_number_id: inactivePid,
      display_phone_number: "+27110000009",
      is_active: false,
    });
    const id = `wamid.unres-owned-${Date.now()}`;
    await post(textPayload(inactivePid, id, "to an inactive number"));

    const mine = await rpc(ws.client, ws.workspaceId, 20);
    const hit = mine.find((r) => r.phone_number_id === inactivePid);
    expect(hit).toBeTruthy();
    expect(hit!.is_unresolved).toBe(true);
    expect(hit!.outcome).toBe("unresolved_number");

    // workspace B (does NOT own inactivePid) never sees it
    const theirs = await rpc(other.client, other.workspaceId, 20);
    expect(theirs.some((r) => r.phone_number_id === inactivePid)).toBe(false);
  });

  it("a member with integration.view can call it; ownership gate still blocks other workspaces", async () => {
    const member = await createTestUser("wh-rpc-member");
    await seedMembership(ws.workspaceId, member.userId, "manager"); // manager has integration.view
    expect((await rpc(member.client, ws.workspaceId, 5)).length).toBeGreaterThan(0);
  });
});
