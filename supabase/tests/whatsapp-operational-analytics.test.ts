// Phase 11 - WhatsApp Analytics & Operational Performance.
//
// Exercises public.get_whatsapp_operational_analytics directly against
// LOCAL Supabase with REAL RLS. Every metric is asserted against a
// hand-seeded cohort with controlled created_at / handoff / resolved_at /
// intake state, so the SQL definition - not a mock - is what is proven.
// No WhatsApp / Meta / OpenAI call anywhere: analytics is pure DB math.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";
import { seedInboxConversation, seedInboxMessage, seedWhatsAppSetup } from "./inboxHelpers";

// A fixed period well clear of "now" so wall-clock drift never matters.
const FROM = "2026-06-01T00:00:00.000Z";
const TO = "2026-07-01T00:00:00.000Z"; // exclusive
const IN_A = "2026-06-05T09:00:00.000Z";
const IN_B = "2026-06-15T09:00:00.000Z";
const BEFORE = "2026-05-20T09:00:00.000Z";
const ON_TO = "2026-07-01T00:00:00.000Z"; // exactly the exclusive bound -> OUT

type Row = {
  conversations_started: number;
  inbound_messages: number;
  median_human_response_seconds: number | null;
  human_response_sample_size: number;
  conversations_with_handoff: number;
  handoff_rate: number | null;
  median_resolution_seconds: number | null;
  conversations_resolved: number;
  intake_applicable: number;
  intake_completed: number;
  intake_completion_rate: number | null;
  handled_ai_only: number;
  handled_human_assisted: number;
  handled_human_only: number;
  handled_no_agent_reply: number;
};

async function rpc(client: SupabaseClient, workspaceId: string, from = FROM, to = TO): Promise<Row[]> {
  const { data, error } = await client.rpc("get_whatsapp_operational_analytics", {
    p_workspace_id: workspaceId, p_date_from: from, p_date_to: to,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

async function mkConv(ws: TestTenant, numberId: string, i: number, over: Record<string, unknown> = {}) {
  return seedInboxConversation(ws.workspaceId, numberId, {
    wa_id: `2799000${String(i).padStart(4, "0")}`,
    phone_number: `+2799000${String(i).padStart(4, "0")}`,
    created_at: IN_A,
    ...over,
  });
}
async function mkMsg(ws: TestTenant, conversationId: string, over: Record<string, unknown>) {
  return seedInboxMessage(ws.workspaceId, conversationId, { created_at: IN_A, ...over });
}
async function schemaId(workspaceId: string) {
  const { data, error } = await admin.from("workspace_intake_schemas")
    .insert({ workspace_id: workspaceId, name: "Ops test schema", is_active: true }).select("id").single();
  if (error || !data) throw new Error(`schema seed failed: ${error?.message}`);
  return data.id as string;
}

async function tokenClient(t: TestTenant) {
  return t.client;
}

describe("Phase 11 - WhatsApp operational analytics RPC", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let numberId: string;
  let otherNumberId: string;

  beforeAll(async () => {
    ws = await createTestTenant("wa-ops");
    other = await createTestTenant("wa-ops-other");
    numberId = (await seedWhatsAppSetup(ws.workspaceId)).id;
    otherNumberId = (await seedWhatsAppSetup(other.workspaceId)).id;
  });
  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  // --- isolation / permissions ---------------------------------------

  it("a brand-new workspace with no conversations returns one honest all-zero/NULL row", async () => {
    const [row] = await rpc(await tokenClient(other), other.workspaceId);
    expect(row.conversations_started).toBe(0);
    expect(row.inbound_messages).toBe(0);
    expect(row.median_human_response_seconds).toBeNull();
    expect(row.handoff_rate).toBeNull();
    expect(row.median_resolution_seconds).toBeNull();
    expect(row.intake_completion_rate).toBeNull();
  });

  it("workspace A's client cannot read workspace B analytics (returns no row)", async () => {
    await mkConv(ws, numberId, 1);
    const rowsCross = await rpc(await tokenClient(other), ws.workspaceId);
    expect(rowsCross).toEqual([]); // has_workspace_permission(inbox.view) fails for the other tenant
  });

  it("a role without inbox.view is denied (no row) even though it can hit the RPC", async () => {
    const marketing = await createTestUser("wa-ops-mkt");
    await seedMembership(ws.workspaceId, marketing.userId, "marketing"); // marketing has view_analytics but NOT inbox.view
    const rows = await rpc(marketing.client, ws.workspaceId);
    expect(rows).toEqual([]);
    // a support member (has inbox.view, no view_analytics) DOES get data
    const support = await createTestUser("wa-ops-support");
    await seedMembership(ws.workspaceId, support.userId, "support");
    const [srow] = await rpc(support.client, ws.workspaceId);
    expect(srow.conversations_started).toBeGreaterThanOrEqual(1);
    await cleanupTenant({ userId: marketing.userId });
    await cleanupTenant({ userId: support.userId });
  });

  it("the RPC returns aggregates ONLY - no message content / transcript / media / phone / wa_id / id", async () => {
    const c = await mkConv(ws, numberId, 2);
    await mkMsg(ws, c.id, { direction: "inbound", sender_type: "customer", content: "my id number is 8801015800089", message_type: "voice", transcript: "secret transcript", media_storage_path: `${ws.workspaceId}/x/y.ogg` });
    const [row] = await rpc(await tokenClient(ws), ws.workspaceId);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("secret transcript");
    expect(serialized).not.toContain("8801015800089");
    expect(serialized).not.toContain(".ogg");
    expect(serialized).not.toContain(c.id);
    expect(serialized).not.toContain("2799000"); // no wa_id / phone fragments
    // every value is a number or null
    for (const v of Object.values(row)) expect(v === null || typeof v === "number").toBe(true);
  });

  // --- volume + date boundaries ------------------------------------

  it("conversation volume counts only conversations started in [from, to) - half-open", async () => {
    const w = await createTestTenant("wa-ops-vol");
    const n = (await seedWhatsAppSetup(w.workspaceId)).id;
    await seedInboxConversation(w.workspaceId, n, { wa_id: "27991", phone_number: "+27991", created_at: IN_A });
    await seedInboxConversation(w.workspaceId, n, { wa_id: "27992", phone_number: "+27992", created_at: IN_B });
    await seedInboxConversation(w.workspaceId, n, { wa_id: "27993", phone_number: "+27993", created_at: BEFORE });   // before range
    await seedInboxConversation(w.workspaceId, n, { wa_id: "27994", phone_number: "+27994", created_at: ON_TO });    // == exclusive bound
    const [row] = await rpc(w.client, w.workspaceId);
    expect(row.conversations_started).toBe(2);
    await cleanupTenant(w);
  });

  it("inbound_messages counts inbound messages in range (voice notes included, no special-casing)", async () => {
    const w = await createTestTenant("wa-ops-inb");
    const n = (await seedWhatsAppSetup(w.workspaceId)).id;
    const c = await seedInboxConversation(w.workspaceId, n, { wa_id: "279a", phone_number: "+279a", created_at: IN_A });
    await seedInboxMessage(w.workspaceId, c.id, { direction: "inbound", sender_type: "customer", message_type: "text", created_at: IN_A });
    await seedInboxMessage(w.workspaceId, c.id, { direction: "inbound", sender_type: "customer", message_type: "voice", created_at: IN_B });
    await seedInboxMessage(w.workspaceId, c.id, { direction: "outbound", sender_type: "ai", created_at: IN_A });     // not inbound
    await seedInboxMessage(w.workspaceId, c.id, { direction: "inbound", sender_type: "customer", message_type: "text", created_at: BEFORE }); // out of range
    const [row] = await rpc(w.client, w.workspaceId);
    expect(row.inbound_messages).toBe(2);
    await cleanupTenant(w);
  });

  // --- human response time (Phase-5 semantics) --------------------

  it("median human response = first STAFF reply at/after handoff minus handoff time; AI reply is not counted", async () => {
    const w = await createTestTenant("wa-ops-resp");
    const n = (await seedWhatsAppSetup(w.workspaceId)).id;
    const handoff = "2026-06-10T10:00:00.000Z";
    // conv 1: handoff -> AI reply after 30s (ignored) -> staff reply after 120s
    const c1 = await seedInboxConversation(w.workspaceId, n, { wa_id: "279r1", phone_number: "+279r1", created_at: IN_A, human_handoff_requested_at: handoff });
    await seedInboxMessage(w.workspaceId, c1.id, { direction: "outbound", sender_type: "ai", created_at: "2026-06-10T10:00:30.000Z" });
    await seedInboxMessage(w.workspaceId, c1.id, { direction: "outbound", sender_type: "staff", created_at: "2026-06-10T10:02:00.000Z" });
    await seedInboxMessage(w.workspaceId, c1.id, { direction: "outbound", sender_type: "staff", created_at: "2026-06-10T10:05:00.000Z" }); // later staff msg - must NOT create a 2nd sample
    // conv 2: handoff -> staff reply after 240s
    const c2 = await seedInboxConversation(w.workspaceId, n, { wa_id: "279r2", phone_number: "+279r2", created_at: IN_A, human_handoff_requested_at: "2026-06-11T10:00:00.000Z" });
    await seedInboxMessage(w.workspaceId, c2.id, { direction: "outbound", sender_type: "staff", created_at: "2026-06-11T10:04:00.000Z" });
    // conv 3: handoff but a staff reply only BEFORE the handoff -> no qualifying response -> excluded
    const c3 = await seedInboxConversation(w.workspaceId, n, { wa_id: "279r3", phone_number: "+279r3", created_at: IN_A, human_handoff_requested_at: "2026-06-12T12:00:00.000Z" });
    await seedInboxMessage(w.workspaceId, c3.id, { direction: "outbound", sender_type: "staff", created_at: "2026-06-12T09:00:00.000Z" });

    const [row] = await rpc(w.client, w.workspaceId);
    expect(row.human_response_sample_size).toBe(2); // c1 (120s) + c2 (240s); c3 excluded
    expect(row.median_human_response_seconds).toBe(180); // median of [120, 240]
    await cleanupTenant(w);
  });

  it("a conversation never handed off contributes no human-response sample", async () => {
    const w = await createTestTenant("wa-ops-nohand");
    const n = (await seedWhatsAppSetup(w.workspaceId)).id;
    const c = await seedInboxConversation(w.workspaceId, n, { wa_id: "279n", phone_number: "+279n", created_at: IN_A });
    await seedInboxMessage(w.workspaceId, c.id, { direction: "outbound", sender_type: "staff", created_at: IN_A });
    const [row] = await rpc(w.client, w.workspaceId);
    expect(row.human_response_sample_size).toBe(0);
    expect(row.median_human_response_seconds).toBeNull();
    await cleanupTenant(w);
  });

  // --- handoff rate (conversation-level) -------------------------

  it("handoff rate counts a conversation once regardless of how many messages/episodes it has", async () => {
    const w = await createTestTenant("wa-ops-hand");
    const n = (await seedWhatsAppSetup(w.workspaceId)).id;
    const c1 = await seedInboxConversation(w.workspaceId, n, { wa_id: "279h1", phone_number: "+279h1", created_at: IN_A, human_handoff_requested_at: IN_B });
    // many messages + an alert-style repeated handoff does not inflate anything
    for (let k = 0; k < 5; k++) await seedInboxMessage(w.workspaceId, c1.id, { direction: "outbound", sender_type: "staff", created_at: IN_B });
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279h2", phone_number: "+279h2", created_at: IN_A }); // no handoff
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279h3", phone_number: "+279h3", created_at: IN_A }); // no handoff
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279h4", phone_number: "+279h4", created_at: IN_A }); // no handoff
    const [row] = await rpc(w.client, w.workspaceId);
    expect(row.conversations_started).toBe(4);
    expect(row.conversations_with_handoff).toBe(1);
    expect(row.handoff_rate).toBeCloseTo(0.25, 4);
    await cleanupTenant(w);
  });

  // --- resolution time -----------------------------------------

  it("median resolution time uses resolved_at; unresolved conversations are excluded from the duration", async () => {
    const w = await createTestTenant("wa-ops-res");
    const n = (await seedWhatsAppSetup(w.workspaceId)).id;
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279s1", phone_number: "+279s1", created_at: "2026-06-05T00:00:00.000Z", resolved_at: "2026-06-05T01:00:00.000Z" }); // 3600s
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279s2", phone_number: "+279s2", created_at: "2026-06-06T00:00:00.000Z", resolved_at: "2026-06-06T03:00:00.000Z" }); // 10800s
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279s3", phone_number: "+279s3", created_at: "2026-06-07T00:00:00.000Z" }); // unresolved -> excluded
    const [row] = await rpc(w.client, w.workspaceId);
    expect(row.conversations_started).toBe(3);
    expect(row.conversations_resolved).toBe(2);
    expect(row.median_resolution_seconds).toBe(7200); // median of [3600, 10800]
    await cleanupTenant(w);
  });

  it("a cohort with zero reliable resolved_at returns N/A resolution, never 0", async () => {
    const w = await createTestTenant("wa-ops-res0");
    const n = (await seedWhatsAppSetup(w.workspaceId)).id;
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279z1", phone_number: "+279z1", created_at: IN_A }); // no resolved_at
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279z2", phone_number: "+279z2", created_at: "2026-06-08T05:00:00.000Z", resolved_at: "2026-06-08T04:00:00.000Z" }); // resolved before created -> anomaly, excluded
    const [row] = await rpc(w.client, w.workspaceId);
    expect(row.conversations_resolved).toBe(0);
    expect(row.median_resolution_seconds).toBeNull();
    await cleanupTenant(w);
  });

  // --- intake completion --------------------------------------

  it("intake denominator = pinned-schema conversations only; numerator = authoritative intake_completed_at", async () => {
    const w = await createTestTenant("wa-ops-intake");
    const n = (await seedWhatsAppSetup(w.workspaceId)).id;
    const sch = await schemaId(w.workspaceId);
    // 3 with a pinned schema, 2 completed
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279i1", phone_number: "+279i1", created_at: IN_A, intake_schema_id: sch, intake_completed_at: IN_B });
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279i2", phone_number: "+279i2", created_at: IN_A, intake_schema_id: sch, intake_completed_at: IN_B });
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279i3", phone_number: "+279i3", created_at: IN_A, intake_schema_id: sch }); // not completed
    // 2 with NO schema -> excluded from BOTH numerator and denominator
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279i4", phone_number: "+279i4", created_at: IN_A });
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279i5", phone_number: "+279i5", created_at: IN_A });
    const [row] = await rpc(w.client, w.workspaceId);
    expect(row.conversations_started).toBe(5);
    expect(row.intake_applicable).toBe(3);
    expect(row.intake_completed).toBe(2);
    expect(row.intake_completion_rate).toBeCloseTo(0.6667, 3);
    await cleanupTenant(w);
  });

  it("no pinned-schema conversations -> intake completion is N/A, not 0%", async () => {
    const w = await createTestTenant("wa-ops-intake0");
    const n = (await seedWhatsAppSetup(w.workspaceId)).id;
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279j1", phone_number: "+279j1", created_at: IN_A });
    const [row] = await rpc(w.client, w.workspaceId);
    expect(row.intake_applicable).toBe(0);
    expect(row.intake_completion_rate).toBeNull();
    await cleanupTenant(w);
  });

  // --- AI vs human handling classification ---------------------

  it("classifies AI-only / human-only / human-assisted / no-reply as a mutually-exclusive partition; automation (system) counts as neither", async () => {
    const w = await createTestTenant("wa-ops-cls");
    const n = (await seedWhatsAppSetup(w.workspaceId)).id;
    // AI-only: ai reply, no staff, never handed off
    const cAi = await seedInboxConversation(w.workspaceId, n, { wa_id: "279c1", phone_number: "+279c1", created_at: IN_A });
    await seedInboxMessage(w.workspaceId, cAi.id, { direction: "outbound", sender_type: "ai", created_at: IN_A });
    // human-only: staff reply, no ai, never handed off
    const cHu = await seedInboxConversation(w.workspaceId, n, { wa_id: "279c2", phone_number: "+279c2", created_at: IN_A });
    await seedInboxMessage(w.workspaceId, cHu.id, { direction: "outbound", sender_type: "staff", created_at: IN_A });
    // human-assisted (handed off) - even with only an AI reply so far
    const cHa = await seedInboxConversation(w.workspaceId, n, { wa_id: "279c3", phone_number: "+279c3", created_at: IN_A, human_handoff_requested_at: IN_B });
    await seedInboxMessage(w.workspaceId, cHa.id, { direction: "outbound", sender_type: "ai", created_at: IN_A });
    // human-assisted (both ai + staff, no explicit handoff flag)
    const cBoth = await seedInboxConversation(w.workspaceId, n, { wa_id: "279c4", phone_number: "+279c4", created_at: IN_A });
    await seedInboxMessage(w.workspaceId, cBoth.id, { direction: "outbound", sender_type: "ai", created_at: IN_A });
    await seedInboxMessage(w.workspaceId, cBoth.id, { direction: "outbound", sender_type: "staff", created_at: IN_A });
    // no agent reply: only an inbound + an AUTOMATION (sender_type='system') message
    const cNone = await seedInboxConversation(w.workspaceId, n, { wa_id: "279c5", phone_number: "+279c5", created_at: IN_A });
    await seedInboxMessage(w.workspaceId, cNone.id, { direction: "inbound", sender_type: "customer", created_at: IN_A });
    await seedInboxMessage(w.workspaceId, cNone.id, { direction: "outbound", sender_type: "system", created_at: IN_A, automation_run_id: crypto.randomUUID(), automation_action_index: 0 });

    const [row] = await rpc(w.client, w.workspaceId);
    expect(row.conversations_started).toBe(5);
    expect(row.handled_ai_only).toBe(1);
    expect(row.handled_human_only).toBe(1);
    expect(row.handled_human_assisted).toBe(2);
    expect(row.handled_no_agent_reply).toBe(1);
    // partition: the four categories sum to the started count
    expect(row.handled_ai_only + row.handled_human_assisted + row.handled_human_only + row.handled_no_agent_reply)
      .toBe(row.conversations_started);
    await cleanupTenant(w);
  });

  // --- previous-period comparison is just a second call ---------

  it("the same RPC over the previous equal-length window is independent and correct", async () => {
    const w = await createTestTenant("wa-ops-prev");
    const n = (await seedWhatsAppSetup(w.workspaceId)).id;
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279p1", phone_number: "+279p1", created_at: IN_A });                 // in current
    await seedInboxConversation(w.workspaceId, n, { wa_id: "279p2", phone_number: "+279p2", created_at: "2026-05-10T00:00:00.000Z" }); // in previous month
    const [cur] = await rpc(w.client, w.workspaceId, FROM, TO);
    const [prev] = await rpc(w.client, w.workspaceId, "2026-05-01T00:00:00.000Z", FROM);
    expect(cur.conversations_started).toBe(1);
    expect(prev.conversations_started).toBe(1);
    await cleanupTenant(w);
  });
});
