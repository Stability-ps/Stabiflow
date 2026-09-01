// Phase 4 - Customer linking + Customer 360. Exercises the real
// customer_match_candidates / customer_360 / customers_search RPCs and the
// inbox-actions link_customer / unlink_customer actions, plus the
// whatsapp-webhook deterministic auto-link. No provider mutation - the
// webhook here always exercises the (mock-token) send-failure path, and
// none of the Customer 360 surface sends anything.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, SUPABASE_URL, getTestEnv, type TestTenant } from "./helpers";
import { seedInboxConversation, seedWhatsAppSetup } from "./inboxHelpers";
import { seedLead, seedOpportunity, seedPipeline } from "./leadsHelpers";

const INBOX_URL = `${SUPABASE_URL}/functions/v1/inbox-actions`;
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");

async function callInbox(token: string, body: Record<string, unknown>) {
  const res = await fetch(INBOX_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function textPayload(phoneNumberId: string, messageId: string, waId: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: waId, profile: { name: "Returning" } }],
      messages: [{ from: waId, id: messageId, type: "text", text: { body: "hi again" } }],
    } }] }],
  });
}
async function postWebhook(body: string) {
  const res = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": await sign(body) }, body });
  return res.status;
}

async function seedCustomer(workspaceId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin.from("customers").insert({ workspace_id: workspaceId, name: "Test Customer", ...overrides }).select("*").single();
  if (error || !data) throw new Error(`seedCustomer failed: ${error?.message}`);
  return data as { id: string; phone_normalized: string | null };
}

describe("Phase 4 - Customer linking + Customer 360", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let numberId: string;
  let phoneNumberId: string;
  let ownerToken: string;

  beforeAll(async () => {
    ws = await createTestTenant("cust360");
    other = await createTestTenant("cust360-other");
    const num = await seedWhatsAppSetup(ws.workspaceId);
    numberId = num.id;
    phoneNumberId = num.phone_number_id;
    await admin.rpc("set_workspace_integration_secret", {
      p_integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", numberId).single()).data!.integration_id,
      p_secret: "mock-whatsapp-token-not-a-real-credential",
    });
    await seedWhatsAppSetup(other.workspaceId);
    ownerToken = (await ws.client.auth.getSession()).data.session!.access_token;
  });

  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  // --- identity matching -----------------------------------------------

  it("exact phone -> one exact deterministic candidate", async () => {
    const cust = await seedCustomer(ws.workspaceId, { name: "Ada", phone: "+27 82 123 4567" });
    expect(cust.phone_normalized).toBe("+27821234567");
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27821234567", wa_id: "27821234567" });
    const { data } = await ws.client.rpc("customer_match_candidates", { p_workspace_id: ws.workspaceId, p_conversation_id: conv.id });
    expect((data ?? []).length).toBe(1);
    expect(data![0].customer_id).toBe(cust.id);
    expect(data![0].match_tier).toBe("exact");
    expect(data![0].match_reason).toContain("phone");
  });

  it("no match -> NEW (zero candidates)", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27999000111", wa_id: "27999000111" });
    const { data } = await ws.client.rpc("customer_match_candidates", { p_workspace_id: ws.workspaceId, p_conversation_id: conv.id });
    expect(data ?? []).toEqual([]);
  });

  it("cross-workspace candidate is never returned", async () => {
    await seedCustomer(other.workspaceId, { name: "Foreign", phone: "+27820007777" });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27820007777", wa_id: "27820007777" });
    const { data } = await ws.client.rpc("customer_match_candidates", { p_workspace_id: ws.workspaceId, p_conversation_id: conv.id });
    expect(data ?? []).toEqual([]);
  });

  it("customer_match_candidates rejects a caller who is not a workspace member", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27820001234", wa_id: "27820001234" });
    const { error } = await other.client.rpc("customer_match_candidates", { p_workspace_id: ws.workspaceId, p_conversation_id: conv.id });
    expect(error).toBeTruthy();
  });

  // --- webhook auto-link ----------------------------------------------

  it("webhook auto-links a new conversation ONLY when exactly one customer has the exact phone", async () => {
    await seedCustomer(ws.workspaceId, { name: "Solo", phone: "+27831110000" });
    expect(await postWebhook(textPayload(phoneNumberId, `wamid.auto-${Date.now()}`, "27831110000"))).toBe(200);
    const { data: linked } = await admin.from("inbox_conversations").select("customer_id").eq("wa_id", "27831110000").single();
    expect(linked!.customer_id).toBeTruthy();

    // ambiguous: two customers with the same phone -> NOT auto-linked
    await seedCustomer(ws.workspaceId, { name: "Dup A", phone: "+27832220000" });
    await seedCustomer(ws.workspaceId, { name: "Dup B", phone: "+27832220000" });
    expect(await postWebhook(textPayload(phoneNumberId, `wamid.ambi-${Date.now()}`, "27832220000"))).toBe(200);
    const { data: ambi } = await admin.from("inbox_conversations").select("customer_id").eq("wa_id", "27832220000").single();
    expect(ambi!.customer_id).toBeNull();
  });

  // --- link / unlink via inbox-actions ------------------------------

  it("link_customer sets conversation.customer_id and additively backfills attribution (NULL-only)", async () => {
    const cust = await seedCustomer(ws.workspaceId, { name: "Linkable", phone: "+27834440000" });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27834440000", wa_id: "27834440000" });
    // an existing attribution row that ALREADY has a customer_id must not be rewritten
    const otherCust = await seedCustomer(ws.workspaceId, { name: "Keep", phone: "+27835550000" });
    await admin.from("attribution_events").insert([
      { workspace_id: ws.workspaceId, conversation_id: conv.id, event_type: "ad_click", platform: "meta", source_type: "paid" },
      { workspace_id: ws.workspaceId, conversation_id: conv.id, event_type: "conversation_started", platform: "organic", source_type: "organic", customer_id: otherCust.id },
    ]);

    const res = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "link_customer", customer_id: cust.id });
    expect(res.status).toBe(200);
    const { data: after } = await admin.from("inbox_conversations").select("customer_id").eq("id", conv.id).single();
    expect(after!.customer_id).toBe(cust.id);

    const { data: attr } = await admin.from("attribution_events").select("platform, customer_id").eq("conversation_id", conv.id).order("platform");
    expect(attr!.find((a) => a.platform === "meta")!.customer_id).toBe(cust.id);        // NULL slot backfilled
    expect(attr!.find((a) => a.platform === "organic")!.customer_id).toBe(otherCust.id); // existing evidence preserved
  });

  it("link_customer rejects a customer from another workspace (404), conversation unchanged", async () => {
    const foreign = await seedCustomer(other.workspaceId, { name: "Nope" });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27836660000", wa_id: "27836660000" });
    const res = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "link_customer", customer_id: foreign.id });
    expect(res.status).toBe(404);
    const { data: after } = await admin.from("inbox_conversations").select("customer_id").eq("id", conv.id).single();
    expect(after!.customer_id).toBeNull();
  });

  it("a member without inbox.manage cannot link/unlink a customer", async () => {
    const marketing = await createTestUser("cust360-mkt");
    await seedMembership(ws.workspaceId, marketing.userId, "marketing");
    const token = (await marketing.client.auth.getSession()).data.session!.access_token;
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27837770000", wa_id: "27837770000" });
    const res = await callInbox(token, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "link_customer", customer_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(403);
    await cleanupTenant({ userId: marketing.userId });
  });

  it("unlink_customer clears the link and never touches attribution", async () => {
    const cust = await seedCustomer(ws.workspaceId, { name: "Temp", phone: "+27838880000" });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27838880000", wa_id: "27838880000" });
    await admin.from("attribution_events").insert({ workspace_id: ws.workspaceId, conversation_id: conv.id, event_type: "ad_click", platform: "meta", source_type: "paid" });
    await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "link_customer", customer_id: cust.id });
    const res = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "unlink_customer" });
    expect(res.status).toBe(200);
    const { data: after } = await admin.from("inbox_conversations").select("customer_id").eq("id", conv.id).single();
    expect(after!.customer_id).toBeNull();
    const { data: attr } = await admin.from("attribution_events").select("customer_id").eq("conversation_id", conv.id).single();
    expect(attr!.customer_id).toBe(cust.id); // backfill from the link stays - unlink is not a rewrite
  });

  // --- Customer 360 read model ------------------------------------

  it("customer_360 returns only this workspace's data, keeps currencies separate, and hides storage paths", async () => {
    const pipe = await seedPipeline(ws.workspaceId);
    const lead = await seedLead(ws.workspaceId, { contact_name: "Grace", phone: "+27840001111", phone_normalized: "+27840001111", pipeline_id: pipe.pipelineId, pipeline_stage_id: pipe.stages[0].id });
    const opp = await seedOpportunity(ws.workspaceId, lead.id, { pipeline_id: pipe.pipelineId, pipeline_stage_id: pipe.stages[0].id, actual_value: 10000 });
    const cust = await seedCustomer(ws.workspaceId, { name: "Grace", phone: "+27840001111", lead_id: lead.id, opportunity_id: opp.id });
    const conv1 = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27840001111", wa_id: "27840001111a", customer_id: cust.id });
    const conv2 = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27840001111", wa_id: "27840001111b", lead_id: lead.id });
    void conv1; void conv2;
    await admin.from("revenue_events").insert([
      { workspace_id: ws.workspaceId, customer_id: cust.id, amount_minor: 1000000, currency: "ZAR", event_type: "payment" },
      { workspace_id: ws.workspaceId, customer_id: cust.id, amount_minor: 50000, currency: "USD", event_type: "payment" },
    ]);
    await admin.from("crm_notes").insert({ workspace_id: ws.workspaceId, target_type: "lead", target_id: lead.id, author_id: ws.userId, author_name: "Owner", body: "VIP" });
    // a foreign customer's revenue must never appear
    const foreignCust = await seedCustomer(other.workspaceId, { name: "Foreign" });
    await admin.from("revenue_events").insert({ workspace_id: other.workspaceId, customer_id: foreignCust.id, amount_minor: 999999, currency: "EUR", event_type: "payment" });

    const { data, error } = await ws.client.rpc("customer_360", { p_workspace_id: ws.workspaceId, p_customer_id: cust.id });
    expect(error).toBeNull();
    const d = data as Record<string, unknown>;
    expect((d.counts as { conversations: number }).conversations).toBe(2);
    expect((d.counts as { leads: number }).leads).toBe(1);
    const rev = d.revenue_by_currency as Array<{ currency: string; total_minor: number }>;
    expect(rev.map((r) => r.currency).sort()).toEqual(["USD", "ZAR"]);
    expect(rev.find((r) => r.currency === "EUR")).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain("storage_path");
    expect((d.notes as unknown[]).length).toBe(1);
    expect((d.timeline as Array<{ at: string }>).length).toBeGreaterThan(0);
    // timeline is chronologically ordered ascending
    const ts = (d.timeline as Array<{ at: string }>).map((t) => new Date(t.at).getTime());
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it("customer_360 rejects a caller from another workspace", async () => {
    const cust = await seedCustomer(ws.workspaceId, { name: "Private" });
    const { error } = await other.client.rpc("customer_360", { p_workspace_id: ws.workspaceId, p_customer_id: cust.id });
    expect(error).toBeTruthy();
  });

  it("customers_search finds by name/phone/company and is workspace-scoped", async () => {
    await seedCustomer(ws.workspaceId, { name: "Searchable Acme", phone: "+27841112222", company_name: "Acme Trading" });
    const { data } = await ws.client.rpc("customers_search", { p_workspace_id: ws.workspaceId, p_query: "acme" });
    expect((data ?? []).some((r: { name: string }) => r.name === "Searchable Acme")).toBe(true);
    const { data: other360 } = await other.client.rpc("customers_search", { p_workspace_id: ws.workspaceId, p_query: "acme" });
    expect(other360).toBeNull();
  });
});
