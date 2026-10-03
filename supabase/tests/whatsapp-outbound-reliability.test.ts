// Phase 9 - WhatsApp outbound retry + dead-letter reliability.
//
// Exercises the two SQL primitives directly against LOCAL Supabase:
//   - claim_whatsapp_retry_batch()   atomic FOR UPDATE SKIP LOCKED claim
//   - apply_whatsapp_retry_outcome() the delivery state machine
// plus the manual retry_message path through the real inbox-actions edge
// function with the MOCK WhatsApp provider (env flag + test-harness header
// both required - see whatsappSendProvider.ts). No real WhatsApp / Meta /
// OpenAI call happens anywhere in this file: the worker's own provider send
// is glue that is smoke-tested on the cron schedule, and every failure
// mode (timeout, 429, 5xx, permanent 4xx, accepted-then-callback) is
// injected by passing the already-classified outcome to the RPC - exactly
// what the worker does after classifyOutboundFailure().
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, getTestEnv, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedInboxMessage, seedWhatsAppSetup } from "./inboxHelpers";

const ACTIONS_URL = `${SUPABASE_URL}/functions/v1/inbox-actions`;
const HARNESS = getTestEnv("INTEGRATIONS_TEST_HARNESS_SECRET");

async function callAction(token: string, body: Record<string, unknown>, withHarness = true) {
  const res = await fetch(ACTIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(withHarness ? { "x-stabiflow-test-harness": HARNESS } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function tokenFor(client: TestTenant["client"]): Promise<string> {
  const { data } = await client.auth.getSession();
  return data.session!.access_token;
}

function agoMinutes(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}
function inSeconds(s: number): string {
  return new Date(Date.now() + s * 1000).toISOString();
}

type FailedOpts = {
  content?: string;
  senderType?: "staff" | "ai" | "system";
  messageType?: string;
  retryCount?: number;
  nextRetryAt?: string | null;
  retryClaimedAt?: string | null;
  deadLetteredAt?: string | null;
  deadLetterReason?: string | null;
  providerMessageId?: string | null;
  deliveryStatus?: string;
  templateId?: string | null;
  templateParameters?: string[] | null;
  automationRunId?: string | null;
  automationActionIndex?: number | null;
};

/** A single logical outbound message that a provider attempt has left in
 * `failed` state (retry pending unless overridden). */
async function seedFailedOutbound(workspaceId: string, conversationId: string, opts: FailedOpts = {}) {
  const row: Record<string, unknown> = {
    workspace_id: workspaceId,
    conversation_id: conversationId,
    direction: "outbound",
    sender_type: opts.senderType ?? "staff",
    message_type: opts.messageType ?? "text",
    content: opts.content ?? "Original outbound text",
    delivery_status: opts.deliveryStatus ?? "failed",
    retry_count: opts.retryCount ?? 0,
    next_retry_at: opts.nextRetryAt === undefined ? agoMinutes(1) : opts.nextRetryAt,
    retry_claimed_at: opts.retryClaimedAt ?? null,
    dead_lettered_at: opts.deadLetteredAt ?? null,
    dead_letter_reason: opts.deadLetterReason ?? null,
    provider_message_id: opts.providerMessageId ?? null,
    last_failure_code: "network_error",
    last_failure_category: "temporary_unavailable",
  };
  if (opts.templateId !== undefined) row.template_id = opts.templateId;
  if (opts.templateParameters !== undefined) row.template_parameters = opts.templateParameters;
  if (opts.automationRunId !== undefined) row.automation_run_id = opts.automationRunId;
  if (opts.automationActionIndex !== undefined) row.automation_action_index = opts.automationActionIndex;
  const { data, error } = await admin.from("inbox_messages").insert(row).select("id").single();
  if (error || !data) throw new Error(`seedFailedOutbound failed: ${error?.message}`);
  return data.id as string;
}

async function msgRow(id: string) {
  const { data, error } = await admin
    .from("inbox_messages")
    .select("id, delivery_status, retry_count, next_retry_at, last_retry_at, retry_claimed_at, dead_lettered_at, dead_letter_reason, provider_message_id, content, automation_run_id, message_type")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`msgRow failed: ${error?.message}`);
  return data;
}

async function applyOutcome(messageId: string, outcome: string, code: string | null = null, category: string | null = null, wamid: string | null = null) {
  const { data, error } = await admin.rpc("apply_whatsapp_retry_outcome", {
    p_message_id: messageId,
    p_outcome: outcome,
    p_failure_code: code,
    p_failure_category: category,
    p_provider_message_id: wamid,
    p_source: "retry_worker",
  });
  if (error) throw new Error(`apply_whatsapp_retry_outcome failed: ${error.message}`);
  return data as { result: string; reason?: string; attempt?: number; delay_seconds?: number; delivery_status?: string };
}

async function claim(limit = 20) {
  const { data, error } = await admin.rpc("claim_whatsapp_retry_batch", { p_limit: limit });
  if (error) throw new Error(`claim_whatsapp_retry_batch failed: ${error.message}`);
  return (data ?? []) as Array<{ id: string; workspace_id: string; conversation_id: string; retry_count: number }>;
}

async function openFailedAlerts(messageId: string) {
  const { data } = await admin
    .from("inbox_alerts")
    .select("id, alert_type, severity, title, body, is_resolved, message_id")
    .eq("alert_type", "message_failed")
    .eq("message_id", messageId);
  return data ?? [];
}

async function activityRows(workspaceId: string, action: string, messageId: string) {
  const { data } = await admin
    .from("workspace_activity_log")
    .select("id, action, metadata")
    .eq("workspace_id", workspaceId)
    .eq("action", action);
  return (data ?? []).filter((r) => (r.metadata as { message_id?: string } | null)?.message_id === messageId);
}

async function outboundCount(conversationId: string) {
  const { count } = await admin
    .from("inbox_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound");
  return count ?? 0;
}

async function seedApprovedTemplate(workspaceId: string, integrationId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("whatsapp_message_templates")
    .insert({
      workspace_id: workspaceId,
      integration_id: integrationId,
      waba_id: "waba-p9",
      provider_template_id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "order_update",
      language: "en_US",
      category: "UTILITY",
      provider_status: "APPROVED",
      components: [{ type: "BODY", text: "Hi {{1}}, your order is on its way." }],
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedApprovedTemplate failed: ${error?.message}`);
  return data.id as string;
}

describe("Phase 9 - WhatsApp outbound retry + dead-letter reliability", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let numberId: string;
  let integrationId: string;
  let convId: string;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    ws = await createTestTenant("wa-retry");
    other = await createTestTenant("wa-retry-other");
    const setup = await seedWhatsAppSetup(ws.workspaceId);
    numberId = setup.id;
    integrationId = setup.integrationId;
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integrationId, p_secret: "mock-whatsapp-token-not-a-real-credential" });
    const otherSetup = await seedWhatsAppSetup(other.workspaceId);
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: otherSetup.integrationId, p_secret: "mock-whatsapp-token-not-a-real-credential" });
    convId = (await seedInboxConversation(ws.workspaceId, numberId, { display_name: "Retry Customer" })).id;
    ownerToken = await tokenFor(ws.client);
    otherToken = await tokenFor(other.client);
  });

  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  // === apply_whatsapp_retry_outcome: classification -> transition =========

  describe("delivery state machine (apply_whatsapp_retry_outcome)", () => {
    it("a retryable failure schedules a bounded retry and increments retry_count, no dead-letter", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId, { retryCount: 0, retryClaimedAt: new Date().toISOString() });
      const out = await applyOutcome(id, "retryable", "network_error", "temporary_unavailable");
      expect(out.result).toBe("retry_scheduled");
      expect(out.attempt).toBe(1);
      const row = await msgRow(id);
      expect(row.retry_count).toBe(1);
      expect(row.dead_lettered_at).toBeNull();
      expect(row.retry_claimed_at).toBeNull(); // released for the next tick
      const deltaS = (new Date(row.next_retry_at!).getTime() - Date.now()) / 1000;
      expect(deltaS).toBeGreaterThan(45);
      expect(deltaS).toBeLessThan(95); // 60s + jitter
    });

    it("follows the 60 / 300 / 900 backoff schedule then dead-letters at the limit", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId, { retryCount: 1 });
      const a2 = await applyOutcome(id, "retryable", "meta_500", "temporary_unavailable");
      expect(a2.result).toBe("retry_scheduled");
      expect(a2.attempt).toBe(2);
      const d2 = (new Date((await msgRow(id)).next_retry_at!).getTime() - Date.now()) / 1000;
      expect(d2).toBeGreaterThan(285);
      expect(d2).toBeLessThan(330); // 300s + jitter

      // retry_count is now 2; the next retryable outcome exhausts the limit
      const a3 = await applyOutcome(id, "retryable", "meta_503", "temporary_unavailable");
      expect(a3.result).toBe("dead_lettered");
      expect(a3.reason).toBe("retry_limit_exhausted");
      const row = await msgRow(id);
      expect(row.retry_count).toBe(3);
      expect(row.dead_lettered_at).not.toBeNull();
      expect(row.dead_letter_reason).toBe("retry_limit_exhausted");
      expect(row.next_retry_at).toBeNull();
    });

    it("a permanent provider error dead-letters immediately (retry_count not advanced past the attempt)", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId, { retryCount: 0 });
      const out = await applyOutcome(id, "permanent", "meta_100", "invalid_request");
      expect(out.result).toBe("dead_lettered");
      const row = await msgRow(id);
      expect(row.dead_lettered_at).not.toBeNull();
      expect(row.dead_letter_reason).toBe("meta_100");
      expect(row.next_retry_at).toBeNull();
    });

    it("a policy-blocked failure dead-letters immediately - never enters auto-retry", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId);
      const out = await applyOutcome(id, "policy_blocked", "meta_190", "expired_token");
      expect(out.result).toBe("dead_lettered");
      expect(out.reason).toBe("policy_blocked");
      const row = await msgRow(id);
      expect(row.dead_lettered_at).not.toBeNull();
      expect(row.next_retry_at).toBeNull();
      // and it is NOT picked up by a subsequent claim pass
      const claimed = await claim(50);
      expect(claimed.find((c) => c.id === id)).toBeUndefined();
    });

    it("a successful retry marks the message accepted (submitted), stores the wamid and clears the schedule", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId, { retryCount: 1, retryClaimedAt: new Date().toISOString() });
      const out = await applyOutcome(id, "success", null, null, "wamid.RETRY_OK_1");
      expect(out.result).toBe("succeeded");
      const row = await msgRow(id);
      expect(row.delivery_status).toBe("submitted");
      expect(row.provider_message_id).toBe("wamid.RETRY_OK_1");
      expect(row.next_retry_at).toBeNull();
      expect(row.retry_claimed_at).toBeNull();
      expect(row.retry_count).toBe(2);
      expect(await activityRows(ws.workspaceId, "whatsapp_retry_succeeded", id)).toHaveLength(1);
    });

    it("a failed provider attempt never fabricates a provider_message_id", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId);
      await applyOutcome(id, "retryable", "network_error", "temporary_unavailable", null);
      expect((await msgRow(id)).provider_message_id).toBeNull();
    });

    it("apply on a missing message id returns not_found", async () => {
      const { data } = await admin.rpc("apply_whatsapp_retry_outcome", {
        p_message_id: "00000000-0000-0000-0000-000000000000", p_outcome: "retryable",
      });
      expect((data as { result: string }).result).toBe("not_found");
    });
  });

  // === idempotency / duplicate-send / callback-wins ======================

  describe("idempotency & status-callback precedence", () => {
    it("a stale scheduled retry cannot downgrade a message already delivered/read", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId, {
        deliveryStatus: "read", providerMessageId: "wamid.DELIVERED", nextRetryAt: agoMinutes(1), retryCount: 1,
      });
      const out = await applyOutcome(id, "retryable", "network_error", "temporary_unavailable");
      expect(out.result).toBe("already_accepted");
      const row = await msgRow(id);
      expect(row.delivery_status).toBe("read"); // NOT downgraded
      expect(row.retry_count).toBe(1); // untouched
      expect(row.next_retry_at).toBeNull(); // pending retry cancelled
    });

    it("a known provider_message_id (accepted-then-timeout) cancels any pending retry", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId, {
        providerMessageId: "wamid.ACCEPTED_BUT_TIMED_OUT", nextRetryAt: agoMinutes(1),
      });
      const out = await applyOutcome(id, "retryable", "network_error", "temporary_unavailable");
      expect(out.result).toBe("already_accepted");
      const row = await msgRow(id);
      expect(row.next_retry_at).toBeNull();
      expect(row.retry_claimed_at).toBeNull();
      // claim never offers a row that already has a provider_message_id
      expect((await claim(50)).find((c) => c.id === id)).toBeUndefined();
    });

    it("apply on an already dead-lettered message is a no-op (already_dead_lettered)", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId, { deadLetteredAt: new Date().toISOString(), deadLetterReason: "meta_100", nextRetryAt: null });
      const out = await applyOutcome(id, "retryable", "network_error", "temporary_unavailable");
      expect(out.result).toBe("already_dead_lettered");
    });

    it("duplicate dead-letter transitions raise exactly one Needs Attention alert", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId, { retryCount: 2 });
      await applyOutcome(id, "retryable", "network_error", "temporary_unavailable"); // -> dead-letter (limit)
      await applyOutcome(id, "retryable", "network_error", "temporary_unavailable"); // already_dead_lettered
      await applyOutcome(id, "permanent", "meta_100", "invalid_request");            // still no second alert
      const alerts = await openFailedAlerts(id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("critical");
      expect(alerts[0].body).not.toMatch(/\{|\}/); // no raw provider JSON
      expect(alerts[0].body).not.toMatch(/\+?\d{10,}/); // no phone number
      expect(await activityRows(ws.workspaceId, "whatsapp_message_dead_lettered", id)).toHaveLength(1);
    });

    it("a successful retry resolves the open message_failed alert", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId, { retryCount: 2 });
      await applyOutcome(id, "retryable", "network_error", "temporary_unavailable"); // dead-letter
      expect((await openFailedAlerts(id)).filter((a) => !a.is_resolved)).toHaveLength(1);
      // a manual retry clears the dead-letter, then a fresh success comes in
      await admin.from("inbox_messages").update({ dead_lettered_at: null, dead_letter_reason: null }).eq("id", id);
      await applyOutcome(id, "success", null, null, "wamid.RECOVERED");
      expect((await openFailedAlerts(id)).filter((a) => !a.is_resolved)).toHaveLength(0);
    });
  });

  // === content immutability across delivery retries ======================

  describe("content immutability (AI / automation / ask-info sends)", () => {
    it("retrying an AI-generated send reuses the SAME logical row and text - no regeneration, no new message", async () => {
      const c = (await seedInboxConversation(ws.workspaceId, numberId)).id;
      const runId = crypto.randomUUID();
      const id = await seedFailedOutbound(ws.workspaceId, c, {
        senderType: "ai", content: "Fixed AI answer #42", automationRunId: runId, automationActionIndex: 0, retryCount: 0,
      });
      const before = await outboundCount(c);
      await applyOutcome(id, "retryable", "network_error", "temporary_unavailable");
      await applyOutcome(id, "success", null, null, "wamid.AI_RETRY");
      const row = await msgRow(id);
      expect(row.id).toBe(id);
      expect(row.content).toBe("Fixed AI answer #42"); // untouched
      expect(row.automation_run_id).toBe(runId);
      expect(await outboundCount(c)).toBe(before); // no new logical message
    });

    it("an automation delivery retry does not create another automation_run row", async () => {
      const c = (await seedInboxConversation(ws.workspaceId, numberId)).id;
      const runId = crypto.randomUUID();
      const id = await seedFailedOutbound(ws.workspaceId, c, { automationRunId: runId, automationActionIndex: 1 });
      const { count: before } = await admin.from("automation_runs").select("id", { count: "exact", head: true }).eq("workspace_id", ws.workspaceId);
      await applyOutcome(id, "success", null, null, "wamid.AUTO_RETRY");
      const { count: after } = await admin.from("automation_runs").select("id", { count: "exact", head: true }).eq("workspace_id", ws.workspaceId);
      expect(after ?? 0).toBe(before ?? 0);
    });
  });

  // === claim_whatsapp_retry_batch: selection + atomicity =================

  describe("claim_whatsapp_retry_batch", () => {
    it("claims a due failed row and excludes not-due / dead-lettered / accepted / non-failed rows", async () => {
      const c = (await seedInboxConversation(ws.workspaceId, numberId)).id;
      const due = await seedFailedOutbound(ws.workspaceId, c, { nextRetryAt: agoMinutes(2) });
      const future = await seedFailedOutbound(ws.workspaceId, c, { nextRetryAt: inSeconds(600) });
      const dead = await seedFailedOutbound(ws.workspaceId, c, { deadLetteredAt: new Date().toISOString(), nextRetryAt: null });
      const accepted = await seedFailedOutbound(ws.workspaceId, c, { providerMessageId: "wamid.X" });
      const sent = await seedFailedOutbound(ws.workspaceId, c, { deliveryStatus: "submitted", nextRetryAt: null });

      const ids = (await claim(50)).map((r) => r.id);
      expect(ids).toContain(due);
      expect(ids).not.toContain(future);
      expect(ids).not.toContain(dead);
      expect(ids).not.toContain(accepted);
      expect(ids).not.toContain(sent);
      // claiming marks retry_claimed_at so an immediate re-claim skips it
      expect((await claim(50)).map((r) => r.id)).not.toContain(due);
    });

    it("a stale claim (worker crashed >5 min ago) becomes eligible again", async () => {
      const c = (await seedInboxConversation(ws.workspaceId, numberId)).id;
      const stale = await seedFailedOutbound(ws.workspaceId, c, { retryClaimedAt: agoMinutes(10), nextRetryAt: agoMinutes(2) });
      const fresh = await seedFailedOutbound(ws.workspaceId, c, { retryClaimedAt: agoMinutes(1), nextRetryAt: agoMinutes(2) });
      const ids = (await claim(50)).map((r) => r.id);
      expect(ids).toContain(stale);
      expect(ids).not.toContain(fresh);
    });

    it("per-workspace fairness: at most 5 rows for one workspace in a single tick", async () => {
      const c = (await seedInboxConversation(ws.workspaceId, numberId)).id;
      const seeded: string[] = [];
      for (let i = 0; i < 8; i++) seeded.push(await seedFailedOutbound(ws.workspaceId, c, { nextRetryAt: agoMinutes(3 + i) }));
      const mine = (await claim(50)).filter((r) => seeded.includes(r.id));
      expect(mine.length).toBeLessThanOrEqual(5);
    });

    it("CONCURRENCY: two workers claiming at once claim every row exactly once", async () => {
      const c = (await seedInboxConversation(ws.workspaceId, numberId)).id;
      const seeded = new Set<string>();
      for (let i = 0; i < 6; i++) seeded.add(await seedFailedOutbound(ws.workspaceId, c, { nextRetryAt: agoMinutes(2) }));

      const [a, b] = await Promise.all([claim(20), claim(20)]);
      const all = [...a, ...b].map((r) => r.id).filter((id) => seeded.has(id));
      const unique = new Set(all);
      expect(unique.size).toBe(all.length); // no row handed to both workers
      // and each claimed row now carries a claim stamp
      for (const id of unique) expect((await msgRow(id)).retry_claimed_at).not.toBeNull();
    });

    it("CONCURRENCY: a single due row goes to exactly one of two simultaneous workers", async () => {
      const c = (await seedInboxConversation(ws.workspaceId, numberId)).id;
      const only = await seedFailedOutbound(ws.workspaceId, c, { nextRetryAt: agoMinutes(2) });
      const [a, b] = await Promise.all([claim(20), claim(20)]);
      const holders = [a, b].filter((batch) => batch.some((r) => r.id === only));
      expect(holders).toHaveLength(1);
    });
  });

  // === manual retry via inbox-actions (retry_message) ====================

  describe("manual retry_message (inbox-actions edge function)", () => {
    async function seedOpenWindowConversation() {
      const c = (await seedInboxConversation(ws.workspaceId, numberId, { display_name: "Windowed" })).id;
      await seedInboxMessage(ws.workspaceId, c, { direction: "inbound", sender_type: "customer", content: "hi", created_at: agoMinutes(30) });
      return c;
    }

    it("requires inbox.manage - a marketing-role member is refused", async () => {
      const c = await seedOpenWindowConversation();
      const id = await seedFailedOutbound(ws.workspaceId, c, { deadLetteredAt: new Date().toISOString(), nextRetryAt: null });
      const mkt = await createTestUser("wa-retry-mkt");
      await seedMembership(ws.workspaceId, mkt.userId, "marketing");
      const res = await callAction(await tokenFor(mkt.client), { workspace_id: ws.workspaceId, conversation_id: c, action: "retry_message", message_id: id });
      expect(res.status).toBe(403);
      await cleanupTenant({ userId: mkt.userId });
    });

    it("rejects a message id from another workspace with 404", async () => {
      const foreignConv = (await seedInboxConversation(other.workspaceId, (await seedWhatsAppSetup(other.workspaceId)).id)).id;
      const foreignMsg = await seedFailedOutbound(other.workspaceId, foreignConv, { deadLetteredAt: new Date().toISOString(), nextRetryAt: null });
      const res = await callAction(ownerToken, { workspace_id: ws.workspaceId, conversation_id: convId, action: "retry_message", message_id: foreignMsg });
      expect(res.status).toBe(404);
    });

    it("refuses a message that was already delivered/read", async () => {
      const c = await seedOpenWindowConversation();
      const id = await seedFailedOutbound(ws.workspaceId, c, { deliveryStatus: "delivered", providerMessageId: "wamid.DONE", nextRetryAt: null });
      const res = await callAction(ownerToken, { workspace_id: ws.workspaceId, conversation_id: c, action: "retry_message", message_id: id });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("already_accepted");
    });

    it("refuses while an active retry claim exists", async () => {
      const c = await seedOpenWindowConversation();
      const id = await seedFailedOutbound(ws.workspaceId, c, { retryClaimedAt: new Date().toISOString(), nextRetryAt: agoMinutes(1) });
      const res = await callAction(ownerToken, { workspace_id: ws.workspaceId, conversation_id: c, action: "retry_message", message_id: id });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("retry_in_progress");
    });

    it("happy path: re-sends a dead-lettered free-form message, clears the dead-letter, logs the request", async () => {
      const c = await seedOpenWindowConversation();
      const id = await seedFailedOutbound(ws.workspaceId, c, { deadLetteredAt: new Date().toISOString(), deadLetterReason: "retry_limit_exhausted", nextRetryAt: null, retryCount: 3 });
      const before = await outboundCount(c);
      const res = await callAction(ownerToken, { workspace_id: ws.workspaceId, conversation_id: c, action: "retry_message", message_id: id });
      expect(res.status).toBe(200);
      expect(res.body.outcome.result).toBe("succeeded");
      const row = await msgRow(id);
      expect(row.delivery_status).toBe("submitted");
      expect(row.provider_message_id).toMatch(/^mock_wamid_/);
      expect(row.dead_lettered_at).toBeNull();
      expect(await outboundCount(c)).toBe(before); // same logical message
      expect(await activityRows(ws.workspaceId, "whatsapp_manual_retry_requested", id)).toHaveLength(1);
    });

    it("a free-form retry outside the 24h window does NOT send - re-blocked as policy", async () => {
      const c = (await seedInboxConversation(ws.workspaceId, numberId)).id; // no inbound message -> window unknown/closed
      const id = await seedFailedOutbound(ws.workspaceId, c, { deadLetteredAt: new Date().toISOString(), nextRetryAt: null });
      const res = await callAction(ownerToken, { workspace_id: ws.workspaceId, conversation_id: c, action: "retry_message", message_id: id });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("messaging_window_closed");
      const row = await msgRow(id);
      expect(row.provider_message_id).toBeNull();
      expect(row.dead_lettered_at).not.toBeNull(); // re-dead-lettered, not sent
    });

    it("a template retry re-validates approval against current state - a no-longer-APPROVED template is refused", async () => {
      const c = (await seedInboxConversation(ws.workspaceId, numberId)).id;
      const tplId = await seedApprovedTemplate(ws.workspaceId, integrationId, { provider_status: "PENDING", name: "stale_tpl", provider_template_id: `stale-${Date.now()}` });
      const id = await seedFailedOutbound(ws.workspaceId, c, {
        messageType: "template", templateId: tplId, templateParameters: ["Sam"],
        deadLetteredAt: new Date().toISOString(), nextRetryAt: null,
      });
      const res = await callAction(ownerToken, { workspace_id: ws.workspaceId, conversation_id: c, action: "retry_message", message_id: id });
      expect(res.status).toBe(422);
      expect(String(res.body.code)).toContain("not_approved");
      expect((await msgRow(id)).provider_message_id).toBeNull();
    });

    it("a suspended workspace cannot manually retry", async () => {
      const c = await seedOpenWindowConversation();
      const id = await seedFailedOutbound(ws.workspaceId, c, { deadLetteredAt: new Date().toISOString(), nextRetryAt: null });
      const { data: billing } = await admin.from("workspace_billing").select("status").eq("workspace_id", ws.workspaceId).single();
      await admin.from("workspace_billing").update({ status: "suspended" }).eq("workspace_id", ws.workspaceId);
      try {
        const res = await callAction(ownerToken, { workspace_id: ws.workspaceId, conversation_id: c, action: "retry_message", message_id: id });
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("workspace_suspended");
      } finally {
        await admin.from("workspace_billing").update({ status: billing!.status }).eq("workspace_id", ws.workspaceId);
      }
      expect((await msgRow(id)).provider_message_id).toBeNull();
    });
  });

  // === tenancy / RLS (spec 29) ==========================================

  describe("multi-tenancy & RLS", () => {
    it("the claim + outcome RPCs are not callable by an authenticated tenant client", async () => {
      const { error: claimErr } = await ws.client.rpc("claim_whatsapp_retry_batch", { p_limit: 5 });
      expect(claimErr).toBeTruthy();
      const { error: applyErr } = await ws.client.rpc("apply_whatsapp_retry_outcome", { p_message_id: crypto.randomUUID(), p_outcome: "retryable" });
      expect(applyErr).toBeTruthy();
    });

    it("workspace B cannot read workspace A's retry / dead-letter columns", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId, { deadLetteredAt: new Date().toISOString(), nextRetryAt: null });
      const { data } = await other.client.from("inbox_messages").select("id, dead_lettered_at, next_retry_at").eq("id", id);
      expect(data ?? []).toEqual([]);
    });

    it("workspace B cannot manually retry workspace A's message (404, no send)", async () => {
      const id = await seedFailedOutbound(ws.workspaceId, convId, { deadLetteredAt: new Date().toISOString(), nextRetryAt: null });
      const res = await callAction(otherToken, { workspace_id: other.workspaceId, conversation_id: convId, action: "retry_message", message_id: id });
      expect(res.status).toBe(404);
      expect((await msgRow(id)).provider_message_id).toBeNull();
    });
  });
});
