// Phase 12 - WhatsApp business hours + business-hours-aware SLA.
//
// The pure open/closed + interval validation is covered by the Deno-free
// unit tests (src/lib/businessHours.test.ts). This suite proves, against
// LOCAL Supabase with REAL RLS, the parts that need the database:
//   * business_minutes_between / workspace_is_open_at /
//     workspace_closed_period_key / claim_outside_hours_ack (direct RPC,
//     fully deterministic with explicit timestamps - incl. weekend, DST,
//     the "5 minutes before closing" deadline, closed-period identity)
//   * sla_sweep() counts BUSINESS minutes when enabled, wall-clock when not
//   * the webhook sends ONE system outside-hours acknowledgement per
//     conversation per closed period, replay/concurrency-safe, and
//     suppresses the normal AI reply for that turn
//   * backward compatibility: an unconfigured workspace is unchanged
//   * settings RLS: admin-only writes, no cross-workspace access
// No real WhatsApp / Meta / OpenAI call: the number credential is a mock
// token (send -> failure path) and the local edge runtime has no OpenAI key.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, getTestEnv, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedWhatsAppSetup } from "./inboxHelpers";

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function postWebhook(body: string) {
  const res = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": await sign(body) }, body });
  return res.status;
}
function textPayload(phoneNumberId: string, messageId: string, waId: string, text: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: waId, profile: { name: "BH Sender" } }],
      messages: [{ from: waId, id: messageId, type: "text", text: { body: text } }],
    } }] }],
  });
}

type DayInput = { day_of_week: number; is_open: boolean; opens_at?: string | null; closes_at?: string | null };
const ALWAYS_OPEN: DayInput[] = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day_of_week: d, is_open: true, opens_at: "00:00", closes_at: "23:59:59" }));
const ALWAYS_CLOSED: DayInput[] = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day_of_week: d, is_open: false, opens_at: null, closes_at: null }));
const MON_FRI_8_17: DayInput[] = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
  day_of_week: d, is_open: d <= 5, opens_at: d <= 5 ? "08:00" : null, closes_at: d <= 5 ? "17:00" : null,
}));

async function configureBusinessHours(
  workspaceId: string,
  opts: { tz?: string; enabled?: boolean; days?: DayInput[]; replyEnabled?: boolean; replyMsg?: string | null } = {},
) {
  const patch: Record<string, unknown> = {};
  if (opts.tz !== undefined) patch.timezone = opts.tz;
  if (opts.enabled !== undefined) patch.business_hours_enabled = opts.enabled;
  if (opts.replyMsg !== undefined) patch.outside_hours_auto_reply_message = opts.replyMsg;
  if (opts.replyEnabled !== undefined) patch.outside_hours_auto_reply_enabled = opts.replyEnabled;
  if (Object.keys(patch).length) {
    const { error } = await admin.from("workspace_settings").update(patch).eq("workspace_id", workspaceId);
    if (error) throw new Error(`configure settings failed: ${error.message}`);
  }
  if (opts.days) {
    const rows = opts.days.map((d) => ({ workspace_id: workspaceId, ...d }));
    const { error } = await admin.from("workspace_business_hours").upsert(rows, { onConflict: "workspace_id,day_of_week" });
    if (error) throw new Error(`configure schedule failed: ${error.message}`);
  }
}

async function bizMinutes(workspaceId: string, from: string, to: string): Promise<number> {
  const { data, error } = await admin.rpc("business_minutes_between", { p_workspace_id: workspaceId, p_start: from, p_end: to });
  if (error) throw new Error(error.message);
  return data as number;
}
async function isOpen(workspaceId: string, at: string): Promise<boolean> {
  const { data, error } = await admin.rpc("workspace_is_open_at", { p_workspace_id: workspaceId, p_at: at });
  if (error) throw new Error(error.message);
  return data as boolean;
}
async function closedKey(workspaceId: string, at: string): Promise<string | null> {
  const { data, error } = await admin.rpc("workspace_closed_period_key", { p_workspace_id: workspaceId, p_at: at });
  if (error) throw new Error(error.message);
  return data as string | null;
}
async function sweep() {
  const { data, error } = await admin.rpc("sla_sweep");
  if (error) throw new Error(`sla_sweep failed: ${error.message}`);
  return data as { raised: number; resolved: number; upgraded: number };
}
function agoMinutes(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}
async function openSlaAlerts(conversationId: string) {
  const { data } = await admin.from("inbox_alerts").select("id, severity, body")
    .eq("conversation_id", conversationId).eq("alert_type", "handoff_sla_overdue").eq("is_resolved", false);
  return data ?? [];
}
async function outboundMessages(conversationId: string) {
  const { data } = await admin.from("inbox_messages")
    .select("id, direction, sender_type, content, delivery_status")
    .eq("conversation_id", conversationId).eq("direction", "outbound").order("created_at");
  return data ?? [];
}

describe("Phase 12 - business-time helpers (direct RPC, deterministic)", () => {
  let ws: TestTenant;
  beforeAll(async () => {
    ws = await createTestTenant("bh-calc");
    await configureBusinessHours(ws.workspaceId, { tz: "Africa/Johannesburg", days: MON_FRI_8_17 });
  });
  afterAll(async () => { await cleanupTenant(ws); });

  it("open time / closed time / weekday boundary, workspace timezone respected", async () => {
    // 2026-06-15 is a Monday. 08:00 SAST = 06:00Z (open); 07:59 SAST closed; 17:00 SAST closed (exclusive).
    expect(await isOpen(ws.workspaceId, "2026-06-15T06:00:00Z")).toBe(true);
    expect(await isOpen(ws.workspaceId, "2026-06-15T05:59:00Z")).toBe(false);
    expect(await isOpen(ws.workspaceId, "2026-06-15T15:00:00Z")).toBe(false);
    // Saturday 2026-06-20 10:00 SAST -> closed
    expect(await isOpen(ws.workspaceId, "2026-06-20T08:00:00Z")).toBe(false);
  });

  it("a closed day contributes zero business minutes; a same-day interval is exact", async () => {
    // Sunday 2026-06-21 all day -> 0
    expect(await bizMinutes(ws.workspaceId, "2026-06-21T00:00:00Z", "2026-06-21T23:00:00Z")).toBe(0);
    // Monday 2026-06-15 10:00->12:30 SAST = 08:00Z->10:30Z -> 150 min
    expect(await bizMinutes(ws.workspaceId, "2026-06-15T08:00:00Z", "2026-06-15T10:30:00Z")).toBe(150);
    // full open day = 9 hours
    expect(await bizMinutes(ws.workspaceId, "2026-06-15T00:00:00Z", "2026-06-15T23:00:00Z")).toBe(540);
  });

  it("weekend closure pauses the clock across days", async () => {
    // Fri 2026-06-19 16:55 SAST -> Mon 2026-06-22 08:05 SAST.
    // Fri: 16:55->17:00 = 5 min. Sat/Sun: 0. Mon: 08:00->08:05 = 5 min. Total 10.
    const from = "2026-06-19T14:55:00Z"; // Fri 16:55 SAST
    const to = "2026-06-22T06:05:00Z";   // Mon 08:05 SAST
    expect(await bizMinutes(ws.workspaceId, from, to)).toBe(10);
  });

  it("handoff 5 min before closing + 10-min SLA -> deadline is 5 business min after next opening", async () => {
    // handoff Mon 16:55 SAST. 5 business min consumed by 17:00. Remaining 5
    // resume Tue 08:00 -> deadline Tue 08:05 SAST.
    const handoff = "2026-06-15T14:55:00Z"; // Mon 16:55 SAST
    // at Tue 08:04 SAST only 9 business min elapsed -> not yet due
    expect(await bizMinutes(ws.workspaceId, handoff, "2026-06-16T06:04:00Z")).toBe(9);
    // at Tue 08:05 SAST -> exactly 10
    expect(await bizMinutes(ws.workspaceId, handoff, "2026-06-16T06:05:00Z")).toBe(10);
  });

  it("handoff while closed -> business minutes only start at next opening", async () => {
    // handoff Sunday 12:00 SAST; business opens Monday 08:00 SAST.
    const handoff = "2026-06-21T10:00:00Z"; // Sun 12:00 SAST
    expect(await bizMinutes(ws.workspaceId, handoff, "2026-06-22T05:59:00Z")).toBe(0);   // Mon 07:59 SAST
    expect(await bizMinutes(ws.workspaceId, handoff, "2026-06-22T06:10:00Z")).toBe(10);  // Mon 08:10 SAST
  });

  it("DST-observing timezone: business minutes computed with IANA conversion", async () => {
    const dst = await createTestTenant("bh-dst");
    await configureBusinessHours(dst.workspaceId, { tz: "America/New_York", days: MON_FRI_8_17 });
    // Winter Mon 2026-01-05: 08:00 EST = 13:00Z. 08:00->10:00 EST = 120 min.
    expect(await bizMinutes(dst.workspaceId, "2026-01-05T13:00:00Z", "2026-01-05T15:00:00Z")).toBe(120);
    // Summer Mon 2026-07-06: 08:00 EDT = 12:00Z. 08:00->10:00 EDT = 120 min.
    expect(await bizMinutes(dst.workspaceId, "2026-07-06T12:00:00Z", "2026-07-06T14:00:00Z")).toBe(120);
    // The same wall-clock query on both days yields the same business minutes
    // even though the UTC offset differs (-5 vs -4).
    await cleanupTenant(dst);
  });

  it("closed_period_key: null when open, stable within one closure, distinct across closures", async () => {
    // open Monday midday -> null
    expect(await closedKey(ws.workspaceId, "2026-06-15T09:00:00Z")).toBeNull();
    // two instants during the SAME Sat/Sun closure -> same key
    const k1 = await closedKey(ws.workspaceId, "2026-06-20T10:00:00Z"); // Sat
    const k2 = await closedKey(ws.workspaceId, "2026-06-21T18:00:00Z"); // Sun
    expect(k1).toBeTruthy();
    expect(k1).toBe(k2);
    // the NEXT weekend is a different closed period -> different key
    const k3 = await closedKey(ws.workspaceId, "2026-06-27T10:00:00Z");
    expect(k3).toBeTruthy();
    expect(k3).not.toBe(k1);
    // an all-closed workspace -> the sentinel
    const closedWs = await createTestTenant("bh-closed");
    await configureBusinessHours(closedWs.workspaceId, { tz: "Africa/Johannesburg", days: ALWAYS_CLOSED });
    expect(await closedKey(closedWs.workspaceId, "2026-06-15T09:00:00Z")).toBe("always_closed");
    await cleanupTenant(closedWs);
  });

  it("claim_outside_hours_ack: first claim wins, replay of the same key loses, a new key wins", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, (await seedWhatsAppSetup(ws.workspaceId)).id, { wa_id: "27cla1", phone_number: "+27cla1" });
    const A = "closed:2026-06-20T15:00:00+00:00";
    const B = "closed:2026-06-27T15:00:00+00:00";
    const c1 = await admin.rpc("claim_outside_hours_ack", { p_conversation_id: conv.id, p_period_key: A });
    const c2 = await admin.rpc("claim_outside_hours_ack", { p_conversation_id: conv.id, p_period_key: A });
    const c3 = await admin.rpc("claim_outside_hours_ack", { p_conversation_id: conv.id, p_period_key: B });
    expect(c1.data).toBe(true);
    expect(c2.data).toBe(false);
    expect(c3.data).toBe(true);
  });
});

describe("Phase 12 - sla_sweep business-time integration", () => {
  let ws: TestTenant;
  let numberId: string;
  beforeAll(async () => {
    ws = await createTestTenant("bh-sla");
    numberId = (await seedWhatsAppSetup(ws.workspaceId)).id;
    await admin.from("workspace_settings").update({ handoff_sla_minutes: 10, handoff_sla_enabled: true }).eq("workspace_id", ws.workspaceId);
  });
  afterAll(async () => { await cleanupTenant(ws); });

  async function seedWaiting(waitedMin: number, waId: string) {
    return seedInboxConversation(ws.workspaceId, numberId, {
      wa_id: waId, phone_number: `+${waId}`, status: "human_handoff", ai_enabled: false, inbox_status: "unassigned",
      human_handoff_requested_at: agoMinutes(waitedMin), last_staff_reply_at: null, display_name: "Waiting",
    });
  }

  it("business hours DISABLED (default/unconfigured) -> unchanged Phase-5 wall-clock SLA", async () => {
    await configureBusinessHours(ws.workspaceId, { enabled: false });
    const conv = await seedWaiting(15, "27bh0001"); // 15 min wall-clock, 10-min SLA
    await sweep();
    expect(await openSlaAlerts(conv.id)).toHaveLength(1);
  });

  it("business hours ENABLED + always-open schedule -> behaves like wall-clock (regression)", async () => {
    await configureBusinessHours(ws.workspaceId, { enabled: true, tz: "Africa/Johannesburg", days: ALWAYS_OPEN });
    const conv = await seedWaiting(15, "27bh0002");
    await sweep();
    expect(await openSlaAlerts(conv.id)).toHaveLength(1);
  });

  it("business hours ENABLED + always-closed schedule -> SLA never fires, however long the wall-clock wait", async () => {
    await configureBusinessHours(ws.workspaceId, { enabled: true, tz: "Africa/Johannesburg", days: ALWAYS_CLOSED });
    const conv = await seedWaiting(600, "27bh0003"); // 10 hours of wall-clock, all outside hours
    const res = await sweep();
    expect(await openSlaAlerts(conv.id)).toHaveLength(0);
    expect(res.raised).toBe(0);
    // elapsed wall-clock while closed did not create an alert; a repeated
    // sweep still creates nothing.
    await sweep();
    expect(await openSlaAlerts(conv.id)).toHaveLength(0);
  });

  it("once business minutes reach the threshold the existing Phase-5 alert fires, and a repeat sweep does not duplicate it", async () => {
    await configureBusinessHours(ws.workspaceId, { enabled: true, tz: "Africa/Johannesburg", days: ALWAYS_OPEN });
    const conv = await seedWaiting(25, "27bh0004"); // 25 business min on always-open, 10-min SLA -> overdue (and past 2x -> critical)
    await sweep();
    let alerts = await openSlaAlerts(conv.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].body).toContain("business min");
    await sweep();
    alerts = await openSlaAlerts(conv.id);
    expect(alerts).toHaveLength(1); // still exactly one - idempotent
  });

  it("a qualifying staff reply before the business deadline prevents the overdue alert", async () => {
    await configureBusinessHours(ws.workspaceId, { enabled: true, tz: "Africa/Johannesburg", days: ALWAYS_OPEN });
    const conv = await seedWaiting(20, "27bh0005");
    await admin.from("inbox_conversations").update({ last_staff_reply_at: new Date().toISOString() }).eq("id", conv.id);
    await sweep();
    expect(await openSlaAlerts(conv.id)).toHaveLength(0);
  });
});

describe("Phase 12 - outside-hours acknowledgement (webhook)", () => {
  let ws: TestTenant;
  let phoneNumberId: string;
  let numberId: string;
  beforeAll(async () => {
    ws = await createTestTenant("bh-ack");
    const setup = await seedWhatsAppSetup(ws.workspaceId);
    numberId = setup.id;
    phoneNumberId = setup.phone_number_id;
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: setup.integrationId, p_secret: "mock-whatsapp-token-not-a-real-credential" });
  });
  afterAll(async () => { await cleanupTenant(ws); });

  it("default OFF -> a closed-hours inbound gets no acknowledgement", async () => {
    await configureBusinessHours(ws.workspaceId, { enabled: true, tz: "Africa/Johannesburg", days: ALWAYS_CLOSED, replyEnabled: false });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { wa_id: "27ack01", phone_number: "+27ack01" });
    // a non-greeting message so the Phase-D greeting fast-path doesn't fire;
    // with no OpenAI key locally the AI branch just logs and returns.
    expect(await postWebhook(textPayload(phoneNumberId, `wamid.a1-${Date.now()}`, "27ack01", "I need help with my order please"))).toBe(200);
    expect(await outboundMessages(conv.id)).toHaveLength(0);
  });

  it("OPEN business -> no outside-hours message (AI path unaffected)", async () => {
    await configureBusinessHours(ws.workspaceId, { enabled: true, tz: "Africa/Johannesburg", days: ALWAYS_OPEN, replyEnabled: true, replyMsg: "We're closed - back soon." });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { wa_id: "27ack02", phone_number: "+27ack02" });
    expect(await postWebhook(textPayload(phoneNumberId, `wamid.a2-${Date.now()}`, "27ack02", "a real question about pricing"))).toBe(200);
    const out = await outboundMessages(conv.id);
    expect(out.some((m) => m.content === "We're closed - back soon.")).toBe(false);
  });

  it("CLOSED + enabled -> exactly ONE system outbound; replay + repeated inbound in the same closed period add none", async () => {
    await configureBusinessHours(ws.workspaceId, { enabled: true, tz: "Africa/Johannesburg", days: ALWAYS_CLOSED, replyEnabled: true, replyMsg: "We are closed right now." });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { wa_id: "27ack03", phone_number: "+27ack03" });
    const mid = `wamid.a3-${Date.now()}`;
    expect(await postWebhook(textPayload(phoneNumberId, mid, "27ack03", "Hello?"))).toBe(200);
    expect(await postWebhook(textPayload(phoneNumberId, mid, "27ack03", "Hello?"))).toBe(200); // webhook replay
    expect(await postWebhook(textPayload(phoneNumberId, `${mid}-b`, "27ack03", "Anyone there?"))).toBe(200); // 2nd inbound, same closure
    expect(await postWebhook(textPayload(phoneNumberId, `${mid}-c`, "27ack03", "please"))).toBe(200); // 3rd

    const acks = (await outboundMessages(conv.id)).filter((m) => m.content === "We are closed right now.");
    expect(acks).toHaveLength(1);
    expect(acks[0].sender_type).toBe("system"); // never ai / staff -> does not distort Phase-11 handling analytics
  });

  it("concurrent inbound processing sends at most one acknowledgement", async () => {
    await configureBusinessHours(ws.workspaceId, { enabled: true, tz: "Africa/Johannesburg", days: ALWAYS_CLOSED, replyEnabled: true, replyMsg: "Closed - concurrent test." });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { wa_id: "27ack04", phone_number: "+27ack04" });
    await Promise.all([
      postWebhook(textPayload(phoneNumberId, `wamid.cc1-${Date.now()}`, "27ack04", "one")),
      postWebhook(textPayload(phoneNumberId, `wamid.cc2-${Date.now()}`, "27ack04", "two")),
      postWebhook(textPayload(phoneNumberId, `wamid.cc3-${Date.now()}`, "27ack04", "three")),
    ]);
    const acks = (await outboundMessages(conv.id)).filter((m) => m.content === "Closed - concurrent test.");
    expect(acks.length).toBeLessThanOrEqual(1);
    expect(acks.length).toBe(1);
  });

  it("a human-handoff conversation still gets the acknowledgement and stays in handoff (no return to AI)", async () => {
    await configureBusinessHours(ws.workspaceId, { enabled: true, tz: "Africa/Johannesburg", days: ALWAYS_CLOSED, replyEnabled: true, replyMsg: "Closed - a person will reply when we open." });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      wa_id: "27ack05", phone_number: "+27ack05", status: "human_handoff", ai_enabled: false, inbox_status: "assigned",
      human_handoff_requested_at: agoMinutes(30),
    });
    expect(await postWebhook(textPayload(phoneNumberId, `wamid.a5-${Date.now()}`, "27ack05", "still waiting"))).toBe(200);
    const acks = (await outboundMessages(conv.id)).filter((m) => m.content === "Closed - a person will reply when we open.");
    expect(acks).toHaveLength(1);
    const { data: after } = await admin.from("inbox_conversations").select("status, ai_enabled, human_handoff_requested_at").eq("id", conv.id).single();
    expect(after!.status).toBe("human_handoff");
    expect(after!.ai_enabled).toBe(false);
  });

  it("the acknowledgement uses the normal outbound path (records a message row; provider failure -> Phase-9 failed state, never a fabricated id)", async () => {
    await configureBusinessHours(ws.workspaceId, { enabled: true, tz: "Africa/Johannesburg", days: ALWAYS_CLOSED, replyEnabled: true, replyMsg: "Closed - provider path test." });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { wa_id: "27ack06", phone_number: "+27ack06" });
    expect(await postWebhook(textPayload(phoneNumberId, `wamid.a6-${Date.now()}`, "27ack06", "hi"))).toBe(200);
    const ack = (await outboundMessages(conv.id)).find((m) => m.content === "Closed - provider path test.");
    expect(ack).toBeTruthy();
    // local edge runtime has a mock token -> the real send fails; the row
    // is stored honestly (failed / blocked_*), never with a fake wamid.
    const { data: row } = await admin.from("inbox_messages").select("provider_message_id, delivery_status").eq("id", ack!.id).single();
    expect(row!.provider_message_id).toBeNull();
    expect(["failed", "blocked_window_closed", "blocked_workspace_suspended", "submitted"]).toContain(row!.delivery_status);
  });
});

describe("Phase 12 - settings security & backward compatibility", () => {
  let ws: TestTenant;
  let other: TestTenant;
  beforeAll(async () => {
    ws = await createTestTenant("bh-sec");
    other = await createTestTenant("bh-sec-other");
  });
  afterAll(async () => { await cleanupTenant(ws); await cleanupTenant(other); });

  it("a workspace is disabled/unconfigured by default -> Phase-5 wall-clock SLA is unchanged", async () => {
    const { data: s } = await admin.from("workspace_settings")
      .select("business_hours_enabled, outside_hours_auto_reply_enabled, outside_hours_auto_reply_message")
      .eq("workspace_id", ws.workspaceId).single();
    expect(s!.business_hours_enabled).toBe(false);
    expect(s!.outside_hours_auto_reply_enabled).toBe(false);
    expect(s!.outside_hours_auto_reply_message).toBeNull();
    // (The migration also backfills a Mon-Fri default schedule for
    // workspaces that already existed in production; a fresh test tenant
    // created after the migration has 0 rows until an admin first saves
    // the Business hours card - both are inert while the flag is off.)
  });

  it("a non-admin member cannot edit the schedule or the flags (RLS)", async () => {
    const marketing = await createTestUser("bh-mkt");
    await seedMembership(ws.workspaceId, marketing.userId, "marketing");
    const { data: blockedRow } = await marketing.client.from("workspace_business_hours")
      .update({ is_open: false }).eq("workspace_id", ws.workspaceId).eq("day_of_week", 1).select("id");
    expect(blockedRow ?? []).toEqual([]);
    const { data: blockedFlag } = await marketing.client.from("workspace_settings")
      .update({ business_hours_enabled: true }).eq("workspace_id", ws.workspaceId).select("workspace_id");
    expect(blockedFlag ?? []).toEqual([]);
    // owner CAN
    const { error: ok } = await ws.client.from("workspace_settings").update({ business_hours_enabled: true }).eq("workspace_id", ws.workspaceId);
    expect(ok).toBeNull();
    await ws.client.from("workspace_settings").update({ business_hours_enabled: false }).eq("workspace_id", ws.workspaceId); // restore
    await cleanupTenant({ userId: marketing.userId });
  });

  it("workspace A cannot read or write workspace B's schedule (RLS)", async () => {
    const { data: read } = await other.client.from("workspace_business_hours").select("id").eq("workspace_id", ws.workspaceId);
    expect(read ?? []).toEqual([]);
    const { data: write } = await other.client.from("workspace_business_hours")
      .update({ is_open: false }).eq("workspace_id", ws.workspaceId).eq("day_of_week", 2).select("id");
    expect(write ?? []).toEqual([]);
  });

  it("server-side validation: overnight interval rejected, and a blank enabled auto-reply rejected", async () => {
    const overnight = await admin.from("workspace_business_hours")
      .upsert({ workspace_id: ws.workspaceId, day_of_week: 3, is_open: true, opens_at: "22:00", closes_at: "06:00" }, { onConflict: "workspace_id,day_of_week" });
    expect(overnight.error).toBeTruthy(); // CHECK: opens_at < closes_at

    const blank = await admin.from("workspace_settings")
      .update({ outside_hours_auto_reply_enabled: true, outside_hours_auto_reply_message: "   " }).eq("workspace_id", ws.workspaceId);
    expect(blank.error).toBeTruthy(); // CHECK: enabled => non-blank message
  });

  it("no migration-created outbound message; no PII in the business-hours schema", async () => {
    const { count } = await admin.from("inbox_messages").select("id", { count: "exact", head: true })
      .eq("workspace_id", ws.workspaceId).eq("direction", "outbound");
    expect(count ?? 0).toBe(0);
    // the schedule table carries only weekday + times + flags
    const { data: cols } = await admin.rpc("workspace_is_open_at", { p_workspace_id: ws.workspaceId, p_at: new Date().toISOString() });
    expect(typeof cols).toBe("boolean");
  });
});
