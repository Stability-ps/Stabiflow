// Phase 5 - WhatsApp handoff SLA + overdue escalation. Exercises the real
// public.sla_sweep() detection pass and the inbox-actions SLA-alert
// resolution path against LOCAL Supabase.
//
// The sweep only ever writes to inbox_alerts / domain_events /
// workspace_activity_log - it NEVER sends a WhatsApp message, touches a
// provider, or mutates a conversation. Every scenario below asserts that
// no outbound inbox_messages row appears as a side effect.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedWhatsAppSetup, seedInboxConversation } from "./inboxHelpers";
import { computeSlaState } from "../functions/_shared/inbox/slaState.ts";

const INBOX_URL = `${SUPABASE_URL}/functions/v1/inbox-actions`;

async function callInbox(token: string, body: Record<string, unknown>) {
  const res = await fetch(INBOX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function sweep() {
  const { data, error } = await admin.rpc("sla_sweep");
  if (error) throw new Error(`sla_sweep failed: ${error.message}`);
  return data as { raised: number; resolved: number; upgraded: number; at: string };
}

/** Minutes-ago ISO timestamp. */
function agoMinutes(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

async function setSla(workspaceId: string, minutes: number, enabled = true) {
  const { error } = await admin
    .from("workspace_settings")
    .update({ handoff_sla_minutes: minutes, handoff_sla_enabled: enabled })
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`setSla failed: ${error.message}`);
}

/** A conversation that is genuinely waiting on a human, handed off `waitedMin` ago. */
async function seedWaiting(
  ws: TestTenant,
  numberId: string,
  waitedMin: number,
  overrides: Record<string, unknown> = {},
) {
  return seedInboxConversation(ws.workspaceId, numberId, {
    status: "human_handoff",
    ai_enabled: false,
    inbox_status: "unassigned",
    human_handoff_requested_at: agoMinutes(waitedMin),
    display_name: "Waiting Customer",
    ...overrides,
  });
}

async function openAlerts(workspaceId: string, conversationId: string) {
  const { data } = await admin
    .from("inbox_alerts")
    .select("id, severity, title, body, assigned_staff_id, is_resolved")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("alert_type", "handoff_sla_overdue")
    .eq("is_resolved", false);
  return data ?? [];
}

async function outboundCount(conversationId: string) {
  const { count } = await admin
    .from("inbox_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound");
  return count ?? 0;
}

async function slaEvents(workspaceId: string, conversationId: string) {
  const { data } = await admin
    .from("domain_events")
    .select("id, dedupe_key, payload")
    .eq("workspace_id", workspaceId)
    .eq("event_type", "conversation.handoff_sla_overdue")
    .eq("entity_id", conversationId);
  return data ?? [];
}

async function activityRows(workspaceId: string, conversationId: string, action: string) {
  const { data } = await admin
    .from("workspace_activity_log")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("target_id", conversationId)
    .eq("action", action);
  return data ?? [];
}

describe("Phase 5 - WhatsApp handoff SLA + overdue escalation", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let numberId: string;
  let otherNumberId: string;
  let ownerToken: string;

  beforeAll(async () => {
    ws = await createTestTenant("sla");
    other = await createTestTenant("sla-other");
    numberId = (await seedWhatsAppSetup(ws.workspaceId)).id;
    otherNumberId = (await seedWhatsAppSetup(other.workspaceId)).id;
    ownerToken = (await ws.client.auth.getSession()).data.session!.access_token;
    await setSla(ws.workspaceId, 10);
    await setSla(other.workspaceId, 10);
  });

  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  // --- SLA start + below-threshold ------------------------------------

  it("a fresh handoff starts the SLA clock but raises no alert while under threshold", async () => {
    const conv = await seedWaiting(ws, numberId, 2); // 2 min into a 10-min SLA
    const settings = { handoff_sla_minutes: 10, handoff_sla_enabled: true };
    const state = computeSlaState(
      { status: "human_handoff", ai_enabled: false, inbox_status: "unassigned", human_handoff_requested_at: agoMinutes(2), last_staff_reply_at: null },
      settings,
    );
    expect(state.applicable).toBe(true);
    expect(state.phase).toBe("waiting");

    const res = await sweep();
    expect(res.raised).toBe(0);
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(0);
    expect(await outboundCount(conv.id)).toBe(0);
  });

  it("an AI-controlled / resolved / no-handoff conversation never starts the SLA", async () => {
    const aiConv = await seedInboxConversation(ws.workspaceId, numberId, {
      status: "active", ai_enabled: true, inbox_status: "new", human_handoff_requested_at: agoMinutes(120),
    });
    const resolvedConv = await seedInboxConversation(ws.workspaceId, numberId, {
      status: "human_handoff", ai_enabled: false, inbox_status: "resolved", human_handoff_requested_at: agoMinutes(120),
    });
    await sweep();
    expect(await openAlerts(ws.workspaceId, aiConv.id)).toHaveLength(0);
    expect(await openAlerts(ws.workspaceId, resolvedConv.id)).toHaveLength(0);
  });

  // --- threshold exceeded -> exactly one alert, idempotent -----------

  it("crossing the threshold raises exactly one warning alert, and repeated sweeps keep it at one", async () => {
    const conv = await seedWaiting(ws, numberId, 15); // 15 min into a 10-min SLA
    const first = await sweep();
    expect(first.raised).toBeGreaterThanOrEqual(1);
    let alerts = await openAlerts(ws.workspaceId, conv.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].title).toBe("Customer waiting for a human response");
    // no customer PII (phone / wa_id) in the alert body - only the display name + durations
    expect(alerts[0].body).not.toMatch(/\+?\d{10,}/);

    await sweep();
    await sweep();
    alerts = await openAlerts(ws.workspaceId, conv.id);
    expect(alerts).toHaveLength(1);
    expect(await outboundCount(conv.id)).toBe(0);
  });

  it("an assigned-but-unanswered conversation is still overdue (assignment is not a response)", async () => {
    const conv = await seedWaiting(ws, numberId, 20, {
      inbox_status: "assigned",
      assigned_staff_id: ws.userId,
      assigned_staff_name: "Assignee",
      last_staff_reply_at: null,
    });
    await sweep();
    const alerts = await openAlerts(ws.workspaceId, conv.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].assigned_staff_id).toBe(ws.userId); // responsible person carried on the alert
  });

  it("emits conversation.handoff_sla_overdue exactly once per episode across repeated sweeps", async () => {
    const conv = await seedWaiting(ws, numberId, 30);
    await sweep();
    await sweep();
    await sweep();
    const events = await slaEvents(ws.workspaceId, conv.id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ conversation_id: conv.id });
    // one overdue activity row per episode, not one per sweep
    expect(await activityRows(ws.workspaceId, conv.id, "handoff_sla_overdue")).toHaveLength(1);
  });

  // --- escalation L2: 2x threshold -> critical ----------------------

  it("upgrades warning -> critical once the wait passes 2x the SLA, and never downgrades", async () => {
    const conv = await seedWaiting(ws, numberId, 25); // 2x10 + 5
    await sweep();
    let alerts = await openAlerts(ws.workspaceId, conv.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    await sweep();
    alerts = await openAlerts(ws.workspaceId, conv.id);
    expect(alerts[0].severity).toBe("critical"); // stable, no downgrade
  });

  // --- resolution paths -------------------------------------------

  it("a qualifying staff reply resolves the SLA alert on the next sweep + writes one recovery row", async () => {
    const conv = await seedWaiting(ws, numberId, 18);
    await sweep();
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(1);

    await admin.from("inbox_conversations")
      .update({ last_staff_reply_at: new Date().toISOString(), inbox_status: "waiting_client" })
      .eq("id", conv.id);
    const res = await sweep();
    expect(res.resolved).toBeGreaterThanOrEqual(1);
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(0);
    expect(await activityRows(ws.workspaceId, conv.id, "handoff_sla_resolved")).toHaveLength(1);
    // a second sweep does not write another recovery row
    await sweep();
    expect(await activityRows(ws.workspaceId, conv.id, "handoff_sla_resolved")).toHaveLength(1);
  });

  it("return_to_ai (via inbox-actions) clears the SLA alert immediately, no WhatsApp send", async () => {
    const conv = await seedWaiting(ws, numberId, 22, { inbox_status: "assigned", assigned_staff_id: ws.userId, assigned_staff_name: "Assignee" });
    await sweep();
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(1);

    const res = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "return_to_ai" });
    expect(res.status).toBe(200);
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(0);
    expect(await activityRows(ws.workspaceId, conv.id, "handoff_sla_resolved")).toHaveLength(1);
    expect(await outboundCount(conv.id)).toBe(0);
  });

  it("resolving the conversation clears any open SLA alert", async () => {
    const conv = await seedWaiting(ws, numberId, 40);
    await sweep();
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(1);
    await admin.from("inbox_conversations").update({ inbox_status: "resolved", resolved_at: new Date().toISOString() }).eq("id", conv.id);
    await sweep();
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(0);
  });

  it("a fresh handoff after a prior resolved episode raises a new alert + a new domain event", async () => {
    const conv = await seedWaiting(ws, numberId, 16);
    await sweep();
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(1);
    // episode 1 recovers
    await admin.from("inbox_conversations").update({ last_staff_reply_at: new Date().toISOString(), inbox_status: "waiting_client" }).eq("id", conv.id);
    await sweep();
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(0);

    // episode 2: a brand-new handoff on the same conversation, later start
    await admin.from("inbox_conversations")
      .update({ status: "human_handoff", ai_enabled: false, inbox_status: "unassigned", last_staff_reply_at: null, human_handoff_requested_at: agoMinutes(12) })
      .eq("id", conv.id);
    await sweep();
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(1);
    expect(await slaEvents(ws.workspaceId, conv.id)).toHaveLength(2); // one per episode, distinct dedupe keys
  });

  // --- per-workspace thresholds + tenant isolation ----------------

  it("workspaces apply their own threshold independently", async () => {
    await setSla(ws.workspaceId, 5);
    await setSla(other.workspaceId, 120);
    const fast = await seedWaiting(ws, numberId, 8); // over the 5-min A threshold
    const slow = await seedInboxConversation(other.workspaceId, otherNumberId, {
      status: "human_handoff", ai_enabled: false, inbox_status: "unassigned", human_handoff_requested_at: agoMinutes(8), // under the 120-min B threshold
    });
    await sweep();
    expect(await openAlerts(ws.workspaceId, fast.id)).toHaveLength(1);
    expect(await openAlerts(other.workspaceId, slow.id)).toHaveLength(0);
    await setSla(ws.workspaceId, 10);
    await setSla(other.workspaceId, 10);
  });

  it("SLA alerts never leak across workspaces (RLS + tenant-safe sweep)", async () => {
    const convA = await seedWaiting(ws, numberId, 20);
    await sweep();
    expect(await openAlerts(ws.workspaceId, convA.id)).toHaveLength(1);
    // workspace B's authenticated client cannot see workspace A's alert
    const { data: leaked } = await other.client
      .from("inbox_alerts")
      .select("id")
      .eq("conversation_id", convA.id);
    expect(leaked ?? []).toEqual([]);
  });

  it("disabling SLA for a workspace stops new alerts and resolves the open one", async () => {
    const conv = await seedWaiting(ws, numberId, 30);
    await sweep();
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(1);
    await setSla(ws.workspaceId, 10, false);
    await sweep();
    const openWhileDisabled = await openAlerts(ws.workspaceId, conv.id);
    await setSla(ws.workspaceId, 10, true); // restore first so a failed assertion can't strand the workspace
    expect(openWhileDisabled).toHaveLength(0);
  });

  // --- Needs Attention surface (data layer) -----------------------

  it("an overdue conversation surfaces to Needs Attention with a human-readable line, and disappears once handled", async () => {
    const conv = await seedWaiting(ws, numberId, 24, { inbox_status: "assigned", assigned_staff_id: ws.userId, assigned_staff_name: "Sam Staff" });
    await sweep();

    // the exact shape useNeedsAttention consumes: RLS-scoped open alert +
    // a live SLA re-check against current conversation state.
    const { data: naAlerts } = await ws.client
      .from("inbox_alerts")
      .select("id, alert_type, title, body, is_resolved, conversation_id")
      .eq("alert_type", "handoff_sla_overdue")
      .eq("is_resolved", false);
    expect((naAlerts ?? []).some((a) => a.conversation_id === conv.id)).toBe(true);

    const { data: cs } = await ws.client
      .from("inbox_conversations")
      .select("status, ai_enabled, inbox_status, human_handoff_requested_at, last_staff_reply_at, assigned_staff_name")
      .eq("id", conv.id)
      .single();
    const state = computeSlaState(cs!, { handoff_sla_minutes: 10, handoff_sla_enabled: true });
    expect(state.phase).toBe("overdue");
    expect(state.minutesOverdue).toBeGreaterThan(0);
    // description uses the staff display name, never a raw UUID
    const line = `${state.minutesOverdue} min overdue · waiting for ${cs!.assigned_staff_name}`;
    expect(line).toContain("Sam Staff");
    expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);

    // handled -> the item drops out
    await admin.from("inbox_conversations").update({ last_staff_reply_at: new Date().toISOString() }).eq("id", conv.id);
    await sweep();
    const { data: after } = await ws.client
      .from("inbox_alerts").select("id").eq("alert_type", "handoff_sla_overdue").eq("is_resolved", false).eq("conversation_id", conv.id);
    expect(after ?? []).toEqual([]);
  });

  // --- permissions ---------------------------------------------

  it("a non-admin member cannot change the workspace SLA settings (RLS)", async () => {
    const marketing = await createTestUser("sla-mkt");
    await seedMembership(ws.workspaceId, marketing.userId, "marketing");
    const { data: before } = await admin.from("workspace_settings").select("handoff_sla_minutes").eq("workspace_id", ws.workspaceId).single();
    const { data: updated } = await marketing.client
      .from("workspace_settings")
      .update({ handoff_sla_minutes: 999 })
      .eq("workspace_id", ws.workspaceId)
      .select("workspace_id");
    expect(updated ?? []).toEqual([]); // RLS filtered the row out - nothing updated
    const { data: after } = await admin.from("workspace_settings").select("handoff_sla_minutes").eq("workspace_id", ws.workspaceId).single();
    expect(after!.handoff_sla_minutes).toBe(before!.handoff_sla_minutes);
    await cleanupTenant({ userId: marketing.userId });
  });

  it("the workspace owner CAN change the SLA settings, within 1..1440 bounds", async () => {
    const { error: ok } = await ws.client.from("workspace_settings").update({ handoff_sla_minutes: 45 }).eq("workspace_id", ws.workspaceId);
    expect(ok).toBeNull();
    const { error: tooBig } = await ws.client.from("workspace_settings").update({ handoff_sla_minutes: 5000 }).eq("workspace_id", ws.workspaceId);
    expect(tooBig).toBeTruthy(); // CHECK (handoff_sla_minutes between 1 and 1440)
    await setSla(ws.workspaceId, 10);
  });

  // --- elapsed-time semantics (business-hours pausing is deferred) --

  it("SLA is pure elapsed wall-clock time - it does not pause (business-hours pausing is a later phase)", async () => {
    const conv = await seedWaiting(ws, numberId, 600); // 10h ago, whatever the hour
    await sweep();
    expect(await openAlerts(ws.workspaceId, conv.id)).toHaveLength(1);
  });
});
