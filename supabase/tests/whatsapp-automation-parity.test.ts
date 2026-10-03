// Phase 8 - WhatsApp automation parity.
//
// The automation ENGINE plumbing (event matching, condition enrichment,
// dispatch, the conversation.idle_timeout sweep, loop/retry) runs in
// automations-tick, which is gated by AUTOMATIONS_ENABLED and not exercised
// by the local suite - it is covered by supabase/tests/automations.test.ts
// (remote) and the pure Deno unit tests
// (_shared/automations/actionDispatch.test.ts, conditionEvaluator.test.ts).
//
// This suite proves, against the REAL local inbox-actions + RLS, the new
// action SURFACES the engine calls into - each invoked exactly as the
// dispatcher does (the automation creator's own token + _automation_context):
//   set_priority, set_handoff, add_tag, send_whatsapp_template (reply_template
//   with automation context), request_document. It covers priority-change
//   emission + idempotency, the human-handoff transition + SLA start,
//   template outbound safety (approved-only, cross-tenant, suspension,
//   window), send idempotency on retry, tag dedupe, intake-field validation,
//   permission gating and the automation-source audit trail.
//
// No real WhatsApp/Meta/OpenAI: the number credential is a mock token, so a
// template send can only ever hit the mock provider (with the harness
// header) or the provider FAILURE path (without it) - never a real message.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, getTestEnv, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedInboxMessage, seedWhatsAppSetup } from "./inboxHelpers";

const INBOX_URL = `${SUPABASE_URL}/functions/v1/inbox-actions`;
const HARNESS = getTestEnv("INTEGRATIONS_TEST_HARNESS_SECRET");

const AUTOMATION_ID = "00000000-0000-0000-0000-0000000000b1";
// A fresh automation-run identity per call - reusing one across independent
// cases would trip the (automation_run_id, automation_action_index) send
// idempotency guard and make a later send a silent no-op.
const ctx = (actionIndex = 0) => ({ runId: crypto.randomUUID(), automationId: AUTOMATION_ID, actionIndex });

async function callInbox(token: string, body: Record<string, unknown>, harness = false) {
  const res = await fetch(INBOX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(harness ? { "x-stabiflow-test-harness": HARNESS } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function tokenFor(t: { client: SupabaseClient }) {
  const { data } = await t.client.auth.getSession();
  return data.session!.access_token;
}
async function seedApprovedTemplate(workspaceId: string, integrationId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin.from("whatsapp_message_templates").insert({
    workspace_id: workspaceId, integration_id: integrationId, waba_id: "waba-1",
    provider_template_id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "follow_up", language: "en_US", category: "UTILITY", provider_status: "APPROVED",
    components: [{ type: "BODY", text: "Hi {{1}}, following up on your enquiry." }],
    ...overrides,
  }).select("id").single();
  if (error || !data) throw new Error(`seedApprovedTemplate failed: ${error?.message}`);
  return data.id as string;
}
async function activityFor(workspaceId: string, conversationId: string, action: string) {
  const { data } = await admin.from("workspace_activity_log").select("metadata").eq("workspace_id", workspaceId).eq("target_id", conversationId).eq("action", action);
  return data ?? [];
}
async function priorityEvents(conversationId: string) {
  const { data } = await admin.from("domain_events").select("payload").eq("event_type", "conversation.priority_changed").eq("entity_id", conversationId);
  return data ?? [];
}

describe("Phase 8 - WhatsApp automation parity actions", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let numberId: string;
  let integrationId: string;
  let ownerToken: string;

  beforeAll(async () => {
    ws = await createTestTenant("autoparity");
    other = await createTestTenant("autoparity-other");
    const num = await seedWhatsAppSetup(ws.workspaceId);
    numberId = num.id;
    integrationId = (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", numberId).single()).data!.integration_id;
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integrationId, p_secret: "mock-whatsapp-token-not-a-real-credential" });
    await seedWhatsAppSetup(other.workspaceId);
    ownerToken = await tokenFor(ws);
  });
  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  // --- set_priority -------------------------------------------------

  it("set_priority changes priority, emits conversation.priority_changed ONCE per real transition, and is idempotent", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { priority_level: "normal" });
    const r1 = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_priority", priority: "urgent", _automation_context: ctx() });
    expect(r1.status).toBe(200);
    const { data: after } = await admin.from("inbox_conversations").select("priority_level").eq("id", conv.id).single();
    expect(after!.priority_level).toBe("urgent");
    expect(await priorityEvents(conv.id)).toHaveLength(1);
    expect((await priorityEvents(conv.id))[0].payload).toMatchObject({ previous_priority: "normal", new_priority: "urgent" });

    // idempotent: setting the same value again is a no-op, no second event
    const r2 = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_priority", priority: "urgent", _automation_context: ctx() });
    expect(r2.status).toBe(200);
    expect(r2.body.unchanged).toBe(true);
    expect(await priorityEvents(conv.id)).toHaveLength(1);
    // audit records the automation source
    const acts = await activityFor(ws.workspaceId, conv.id, "inbox_conversation_priority_set");
    expect(acts.some((a) => (a.metadata as Record<string, unknown>).source === "automation" && (a.metadata as Record<string, unknown>).automation_id === AUTOMATION_ID)).toBe(true);
  });

  it("set_priority rejects an invalid level", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId);
    const r = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_priority", priority: "critical" });
    expect(r.status).toBe(400);
  });

  // --- set_handoff ------------------------------------------------

  it("set_handoff uses the existing human-takeover transition, opens the handoff alert, emits the takeover event, and starts the SLA clock", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { status: "active", ai_enabled: true, inbox_status: "new" });
    const r = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_handoff", _automation_context: ctx() });
    expect(r.status).toBe(200);
    const { data: after } = await admin.from("inbox_conversations").select("status, ai_enabled, human_handoff_requested_at").eq("id", conv.id).single();
    expect(after!.status).toBe("human_handoff");
    expect(after!.ai_enabled).toBe(false);
    expect(after!.human_handoff_requested_at).toBeTruthy(); // Phase-5 SLA keys off this
    const { count: alerts } = await admin.from("inbox_alerts").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("alert_type", "human_handoff").eq("is_resolved", false);
    expect(alerts).toBe(1);
    const { count: evt } = await admin.from("domain_events").select("id", { count: "exact", head: true }).eq("event_type", "conversation.human_takeover").eq("entity_id", conv.id);
    expect(evt).toBe(1);

    // idempotent: a second call on an already-handed-off conversation is a no-op and does not reset the SLA clock
    const firstTs = after!.human_handoff_requested_at;
    const r2 = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_handoff", _automation_context: ctx() });
    expect(r2.body.unchanged).toBe(true);
    const { data: after2 } = await admin.from("inbox_conversations").select("human_handoff_requested_at").eq("id", conv.id).single();
    expect(after2!.human_handoff_requested_at).toBe(firstTs);
  });

  // --- send_whatsapp_template / request_document (outbound safety) --

  it("an automation template send uses only an APPROVED workspace template, records the outbound row, and never forces a human takeover", async () => {
    const templateId = await seedApprovedTemplate(ws.workspaceId, integrationId);
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { status: "active", ai_enabled: true });
    await seedInboxMessage(ws.workspaceId, conv.id, { created_at: new Date(Date.now() - 48 * 3600_000).toISOString() }); // window closed

    const sendCtx = ctx();
    const r = await callInbox(ownerToken, {
      workspace_id: ws.workspaceId, conversation_id: conv.id, action: "reply_template",
      template_id: templateId, parameters: ["Acme"], _automation_context: sendCtx,
    }, true);
    expect(r.status).toBe(200);
    expect(["submitted", "failed"]).toContain(r.body.delivery_status);

    const { data: msgs } = await admin.from("inbox_messages").select("message_type, sender_type, delivery_status, automation_run_id").eq("conversation_id", conv.id).eq("direction", "outbound");
    expect(msgs).toHaveLength(1);
    expect(msgs![0].message_type).toBe("template");
    expect(msgs![0].sender_type).toBe("system"); // automation send is a system message, not a staff reply
    expect(msgs![0].automation_run_id).toBe(sendCtx.runId);
    // AI is NOT locked and the conversation is NOT forced to human_handoff
    const { data: after } = await admin.from("inbox_conversations").select("ai_enabled, status").eq("id", conv.id).single();
    expect(after!.ai_enabled).toBe(true);
    expect(after!.status).toBe("active");
  });

  it("a retried automation run cannot send the same template twice (idempotent on run + action index)", async () => {
    const templateId = await seedApprovedTemplate(ws.workspaceId, integrationId);
    const conv = await seedInboxConversation(ws.workspaceId, numberId);
    await seedInboxMessage(ws.workspaceId, conv.id);
    const runCtx = { runId: crypto.randomUUID(), automationId: AUTOMATION_ID, actionIndex: 1 };
    const send = () => callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "reply_template", template_id: templateId, parameters: ["X"], _automation_context: runCtx }, true);
    const first = await send();
    const second = await send();
    expect(first.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    const { count } = await admin.from("inbox_messages").select("id", { count: "exact", head: true }).eq("automation_run_id", runCtx.runId);
    expect(count).toBe(1);
  });

  it("workspace suspension blocks an automation template send", async () => {
    const templateId = await seedApprovedTemplate(ws.workspaceId, integrationId);
    const conv = await seedInboxConversation(ws.workspaceId, numberId);
    await seedInboxMessage(ws.workspaceId, conv.id);
    await admin.from("workspace_billing").update({ status: "suspended" }).eq("workspace_id", ws.workspaceId);
    const r = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "reply_template", template_id: templateId, parameters: ["X"], _automation_context: ctx() }, true);
    await admin.from("workspace_billing").update({ status: "active" }).eq("workspace_id", ws.workspaceId);
    expect(r.status).toBe(403);
    const { count } = await admin.from("inbox_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("direction", "outbound");
    expect(count).toBe(0);
  });

  it("a provider send failure records delivery_status='failed', never a fabricated sent status", async () => {
    const templateId = await seedApprovedTemplate(ws.workspaceId, integrationId);
    const conv = await seedInboxConversation(ws.workspaceId, numberId);
    await seedInboxMessage(ws.workspaceId, conv.id);
    // no harness header -> real Graph call with the mock token -> fails
    const r = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "reply_template", template_id: templateId, parameters: ["X"], _automation_context: ctx() });
    expect(r.status).toBe(200);
    expect(r.body.delivery_status).toBe("failed");
    const { data: msg } = await admin.from("inbox_messages").select("delivery_status, provider_message_id").eq("conversation_id", conv.id).eq("direction", "outbound").single();
    expect(msg!.delivery_status).toBe("failed");
    expect(msg!.provider_message_id).toBeNull();
  });

  it("a template that is not APPROVED / not this workspace's is rejected", async () => {
    const pending = await seedApprovedTemplate(ws.workspaceId, integrationId, { provider_status: "PENDING", provider_template_id: `p-${Date.now()}` });
    const foreignIntegration = (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("workspace_id", other.workspaceId).limit(1).single()).data!.integration_id;
    const foreign = await seedApprovedTemplate(other.workspaceId, foreignIntegration, { provider_template_id: `f-${Date.now()}` });
    const conv = await seedInboxConversation(ws.workspaceId, numberId);
    await seedInboxMessage(ws.workspaceId, conv.id);
    expect((await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "reply_template", template_id: pending, parameters: ["X"], _automation_context: ctx() }, true)).status).toBe(422);
    expect((await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "reply_template", template_id: foreign, parameters: ["X"], _automation_context: ctx() }, true)).status).toBe(422);
  });

  it("request_document validates the intake field against THIS conversation's pinned schema", async () => {
    const templateId = await seedApprovedTemplate(ws.workspaceId, integrationId);
    const { data: schema } = await admin.from("workspace_intake_schemas").insert({ workspace_id: ws.workspaceId, name: "Docs", is_active: true }).select("id").single();
    await admin.from("workspace_intake_fields").insert({ schema_id: schema!.id, workspace_id: ws.workspaceId, key: "proof_of_address", label: "Proof of address", question_text: "Send proof of address", field_type: "text", required: true, sort_order: 1 });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { intake_schema_id: schema!.id });
    await seedInboxMessage(ws.workspaceId, conv.id);

    const ok = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "request_document", template_id: templateId, parameters: ["X"], document_field_key: "proof_of_address", _automation_context: ctx() }, true);
    expect(ok.status).toBe(200);
    const bad = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "request_document", template_id: templateId, parameters: ["X"], document_field_key: "tax_number", _automation_context: ctx(5) }, true);
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("unknown_intake_field");
  });

  // --- add_tag --------------------------------------------------

  it("add_tag inserts once and dedupes a repeat (case-insensitive)", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId);
    const r1 = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "add_tag", tag: "Needs-Review", _automation_context: ctx() });
    expect(r1.status).toBe(200);
    const r2 = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "add_tag", tag: "needs-review", _automation_context: ctx() });
    expect(r2.status).toBe(200);
    expect(r2.body.already_present).toBe(true);
    const { count } = await admin.from("inbox_conversation_tags").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id);
    expect(count).toBe(1);
    const { data: tags } = await ws.client.from("inbox_conversation_tags").select("tag, source").eq("conversation_id", conv.id);
    expect(tags![0].source).toBe("automation");
  });

  // --- permissions + tenancy ----------------------------------

  it("a member without inbox.manage cannot run any Phase-8 action, and nothing is mutated", async () => {
    const marketing = await createTestUser("autoparity-mkt");
    await seedMembership(ws.workspaceId, marketing.userId, "marketing");
    const token = await tokenFor(marketing);
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { priority_level: "normal" });
    for (const body of [
      { action: "set_priority", priority: "urgent" },
      { action: "set_handoff" },
      { action: "add_tag", tag: "x" },
    ]) {
      const r = await callInbox(token, { workspace_id: ws.workspaceId, conversation_id: conv.id, ...body });
      expect(r.status).toBe(403);
    }
    const { data: after } = await admin.from("inbox_conversations").select("priority_level, status").eq("id", conv.id).single();
    expect(after!.priority_level).toBe("normal");
    expect(after!.status).toBe("active");
    await cleanupTenant({ userId: marketing.userId });
  });

  it("cross-workspace: an automation context from workspace A cannot act on workspace B's conversation", async () => {
    const otherNumber = (await admin.from("workspace_whatsapp_numbers").select("id").eq("workspace_id", other.workspaceId).limit(1).single()).data!.id;
    const foreignConv = await seedInboxConversation(other.workspaceId, otherNumber);
    for (const body of [
      { action: "set_priority", priority: "urgent" },
      { action: "set_handoff" },
      { action: "add_tag", tag: "spy" },
    ]) {
      const r = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: foreignConv.id, ...body, _automation_context: ctx() });
      expect(r.status).toBe(404); // conversation is invisible to a workspace-A caller
    }
    const { count } = await admin.from("inbox_conversation_tags").select("id", { count: "exact", head: true }).eq("conversation_id", foreignConv.id);
    expect(count).toBe(0);
  });
});
