// Retention V1 - approved policy: WhatsApp messages/media/transcripts
// 730d, resolved alerts 90d, terminal automation runs 180d,
// ai_usage_events 730d. Every RPC is exercised directly against LOCAL
// Supabase with REAL RLS/grants - no Deno edge runtime needed for the SQL
// guard logic itself (see retention-tick.unit.test.ts for the edge
// function's Storage-failure ordering, which IS Deno-only logic).
//
// Excluded-from-retention categories (leads, customers, opportunities,
// attribution_events, revenue_events, domain_events,
// workspace_activity_log, workspace_whatsapp_webhook_events,
// legal_acceptances, platform_deletion_log, Creative Studio assets,
// configuration tables) are proved by absence: this migration adds no
// function that touches any of them, and none of those tables' schemas
// changed. Not re-asserted with a live query per category (out of scope
// for "the migration didn't touch it").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestTenant, cleanupTenant, type TestTenant } from "./helpers";
import { seedInboxConversation, seedInboxMessage, seedWhatsAppSetup } from "./inboxHelpers";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();
const CUTOFF_730 = daysAgo(730);
const CUTOFF_90 = daysAgo(90);
const CUTOFF_180 = daysAgo(180);

async function messageStillExists(id: string) {
  const { data } = await admin.from("inbox_messages").select("id").eq("id", id).maybeSingle();
  return !!data;
}

describe("Retention V1 - text/no-media messages", () => {
  let ws: TestTenant;
  let conversationId: string;

  beforeAll(async () => {
    ws = await createTestTenant("retention-text");
    const num = await seedWhatsAppSetup(ws.workspaceId);
    conversationId = (await seedInboxConversation(ws.workspaceId, num.id)).id;
  });
  afterAll(async () => cleanupTenant(ws));

  it("deletes an old, safe text message; leaves a recent one untouched", async () => {
    const oldId = await seedInboxMessage(ws.workspaceId, conversationId, { created_at: daysAgo(800) });
    const recentId = await seedInboxMessage(ws.workspaceId, conversationId, { created_at: daysAgo(5) });

    const { data: deletedCount, error } = await admin.rpc("retention_delete_eligible_text_messages", { p_cutoff: CUTOFF_730, p_batch_size: 500 });
    if (error) throw new Error(error.message);
    expect(deletedCount as number).toBeGreaterThanOrEqual(1);

    expect(await messageStillExists(oldId)).toBe(false);
    expect(await messageStillExists(recentId)).toBe(true);
  });

  it("protects a retry-eligible message", async () => {
    const id = await seedInboxMessage(ws.workspaceId, conversationId, { created_at: daysAgo(800), direction: "outbound", sender_type: "staff", next_retry_at: new Date().toISOString() });
    await admin.rpc("retention_delete_eligible_text_messages", { p_cutoff: CUTOFF_730, p_batch_size: 500 });
    expect(await messageStillExists(id)).toBe(true);
  });

  it("protects a claimed (retry_claimed_at set) message", async () => {
    const id = await seedInboxMessage(ws.workspaceId, conversationId, { created_at: daysAgo(800), direction: "outbound", sender_type: "staff", retry_claimed_at: new Date().toISOString() });
    await admin.rpc("retention_delete_eligible_text_messages", { p_cutoff: CUTOFF_730, p_batch_size: 500 });
    expect(await messageStillExists(id)).toBe(true);
  });

  it("protects an unresolved dead-lettered message", async () => {
    const id = await seedInboxMessage(ws.workspaceId, conversationId, { created_at: daysAgo(800), direction: "outbound", sender_type: "staff", dead_lettered_at: new Date().toISOString(), dead_letter_reason: "permanent_error" });
    await admin.rpc("retention_delete_eligible_text_messages", { p_cutoff: CUTOFF_730, p_batch_size: 500 });
    expect(await messageStillExists(id)).toBe(true);
  });

  // A lead_attachments row citing message_id must have storage_path equal
  // to that message's OWN media_storage_path (DB trigger,
  // 20260919090000_conversation_crm_remediation.sql "M3") - so a
  // lead-attachment-referenced message always carries media and can never
  // reach the TEXT/no-media delete path in the first place. That
  // real-world case is covered instead in "Retention V1 - media
  // claim/confirm" below ("a lead-attachment-referenced media message is
  // never claimed").

  it("is idempotent - a second run finds nothing new to delete", async () => {
    await seedInboxMessage(ws.workspaceId, conversationId, { created_at: daysAgo(900) });
    const first = await admin.rpc("retention_delete_eligible_text_messages", { p_cutoff: CUTOFF_730, p_batch_size: 500 });
    const second = await admin.rpc("retention_delete_eligible_text_messages", { p_cutoff: CUTOFF_730, p_batch_size: 500 });
    expect((first.data as number) >= 0).toBe(true);
    expect(second.data as number).toBe(0);
  });

  it("a normal authenticated tenant session cannot call the retention RPC directly", async () => {
    const { error } = await ws.client.rpc("retention_delete_eligible_text_messages", { p_cutoff: CUTOFF_730, p_batch_size: 500 });
    expect(error).toBeTruthy();
  });
});

describe("Retention V1 - media claim/confirm", () => {
  let ws: TestTenant;
  let conversationId: string;

  beforeAll(async () => {
    ws = await createTestTenant("retention-media");
    const num = await seedWhatsAppSetup(ws.workspaceId);
    conversationId = (await seedInboxConversation(ws.workspaceId, num.id)).id;
  });
  afterAll(async () => cleanupTenant(ws));

  it("claims an eligible media message, then confirm-delete removes it", async () => {
    const id = await seedInboxMessage(ws.workspaceId, conversationId, {
      created_at: daysAgo(800), message_type: "image", media_storage_path: `${ws.workspaceId}/old.jpg`,
    });

    const { data: claimed, error: claimError } = await admin.rpc("retention_claim_media_messages_batch", { p_cutoff: CUTOFF_730, p_batch_size: 200 });
    if (claimError) throw new Error(claimError.message);
    const row = (claimed as Array<{ id: string; storage_path: string }>).find((r) => r.id === id);
    expect(row).toBeTruthy();
    expect(row!.storage_path).toBe(`${ws.workspaceId}/old.jpg`);

    // A second claim call must NOT re-claim the same row while it's held.
    const { data: reclaim } = await admin.rpc("retention_claim_media_messages_batch", { p_cutoff: CUTOFF_730, p_batch_size: 200 });
    expect((reclaim as Array<{ id: string }>).some((r) => r.id === id)).toBe(false);

    const { data: confirmed, error: confirmError } = await admin.rpc("retention_confirm_media_message_deleted", { p_message_id: id });
    if (confirmError) throw new Error(confirmError.message);
    expect(confirmed).toBe(true);
    expect(await messageStillExists(id)).toBe(false);
  });

  it("releasing a claim makes the row immediately re-claimable (simulates a Storage delete failure)", async () => {
    const id = await seedInboxMessage(ws.workspaceId, conversationId, {
      created_at: daysAgo(800), message_type: "image", media_storage_path: `${ws.workspaceId}/retry.jpg`,
    });
    await admin.rpc("retention_claim_media_messages_batch", { p_cutoff: CUTOFF_730, p_batch_size: 200 });
    await admin.rpc("retention_release_media_claim", { p_message_id: id });

    const { data: reclaimed } = await admin.rpc("retention_claim_media_messages_batch", { p_cutoff: CUTOFF_730, p_batch_size: 200 });
    expect((reclaimed as Array<{ id: string }>).some((r) => r.id === id)).toBe(true);
  });

  it("confirm-delete refuses a message that was never claimed (no SELECT-then-blind-DELETE)", async () => {
    const id = await seedInboxMessage(ws.workspaceId, conversationId, {
      created_at: daysAgo(800), message_type: "image", media_storage_path: `${ws.workspaceId}/unclaimed.jpg`,
    });
    const { data: confirmed } = await admin.rpc("retention_confirm_media_message_deleted", { p_message_id: id });
    expect(confirmed).toBe(false);
    expect(await messageStillExists(id)).toBe(true);
  });

  it("a lead-attachment-referenced media message is never claimed", async () => {
    const id = await seedInboxMessage(ws.workspaceId, conversationId, {
      created_at: daysAgo(800), message_type: "image", media_storage_path: `${ws.workspaceId}/crm-linked.jpg`,
    });
    const { data: lead } = await admin.from("leads").insert({ workspace_id: ws.workspaceId, human_reference: `RET-M-${Date.now()}`, source: "whatsapp" }).select("id").single();
    await admin.from("lead_attachments").insert({ workspace_id: ws.workspaceId, lead_id: lead!.id, message_id: id, storage_path: `${ws.workspaceId}/crm-linked.jpg` });

    const { data: claimed } = await admin.rpc("retention_claim_media_messages_batch", { p_cutoff: CUTOFF_730, p_batch_size: 200 });
    expect((claimed as Array<{ id: string }>).some((r) => r.id === id)).toBe(false);
  });
});

describe("Retention V1 - resolved alerts, terminal automation runs, ai_usage_events", () => {
  let ws: TestTenant;
  let conversationId: string;

  beforeAll(async () => {
    ws = await createTestTenant("retention-ops");
    const num = await seedWhatsAppSetup(ws.workspaceId);
    conversationId = (await seedInboxConversation(ws.workspaceId, num.id)).id;
  });
  afterAll(async () => cleanupTenant(ws));

  it("deletes an old resolved alert; keeps an old UNRESOLVED alert", async () => {
    const { data: resolved } = await admin.from("inbox_alerts").insert({
      workspace_id: ws.workspaceId, conversation_id: conversationId, alert_type: "message_failed", title: "old resolved",
      is_resolved: true, resolved_at: daysAgo(100), created_at: daysAgo(100),
    }).select("id").single();
    const { data: unresolved } = await admin.from("inbox_alerts").insert({
      workspace_id: ws.workspaceId, conversation_id: conversationId, alert_type: "high_priority", title: "old unresolved",
      is_resolved: false, created_at: daysAgo(100),
    }).select("id").single();

    const { data: count, error } = await admin.rpc("retention_delete_resolved_alerts", { p_cutoff: CUTOFF_90, p_batch_size: 500 });
    if (error) throw new Error(error.message);
    expect(count as number).toBeGreaterThanOrEqual(1);

    expect((await admin.from("inbox_alerts").select("id").eq("id", resolved!.id).maybeSingle()).data).toBeNull();
    expect((await admin.from("inbox_alerts").select("id").eq("id", unresolved!.id).maybeSingle()).data).toBeTruthy();
  });

  it("deletes an old terminal automation run; keeps a pending/in_progress run", async () => {
    const { data: automation } = await admin.from("automations").insert({
      workspace_id: ws.workspaceId, name: "Retention test automation", status: "enabled", trigger_event_type: "lead.created", created_by: ws.userId,
    }).select("id").single();
    // Two distinct events: automation_runs has a UNIQUE(automation_id,
    // domain_event_id) idempotency constraint - one run per automation per
    // triggering event - so the terminal and pending runs each need their
    // own event.
    const { data: event1 } = await admin.from("domain_events").insert({
      workspace_id: ws.workspaceId, event_type: "lead.created", entity_type: "lead", dedupe_key: `retention-test-${Date.now()}-1`,
    }).select("id").single();
    const { data: event2 } = await admin.from("domain_events").insert({
      workspace_id: ws.workspaceId, event_type: "lead.created", entity_type: "lead", dedupe_key: `retention-test-${Date.now()}-2`,
    }).select("id").single();
    const { data: terminalRun } = await admin.from("automation_runs").insert({
      automation_id: automation!.id, workspace_id: ws.workspaceId, domain_event_id: event1!.id, status: "succeeded",
      finished_at: daysAgo(200), created_at: daysAgo(200),
    }).select("id").single();
    const { data: pendingRun } = await admin.from("automation_runs").insert({
      automation_id: automation!.id, workspace_id: ws.workspaceId, domain_event_id: event2!.id, status: "pending",
      created_at: daysAgo(200),
    }).select("id").single();

    const { data: count, error } = await admin.rpc("retention_delete_terminal_automation_runs", { p_cutoff: CUTOFF_180, p_batch_size: 500 });
    if (error) throw new Error(error.message);
    expect(count as number).toBeGreaterThanOrEqual(1);

    expect((await admin.from("automation_runs").select("id").eq("id", terminalRun!.id).maybeSingle()).data).toBeNull();
    expect((await admin.from("automation_runs").select("id").eq("id", pendingRun!.id).maybeSingle()).data).toBeTruthy();
  });

  it("deletes old ai_usage_events; keeps a recent one", async () => {
    const { data: old } = await admin.from("ai_usage_events").insert({
      workspace_id: ws.workspaceId, feature: "flow_ai_chat", model: "gpt-test", status: "success", created_at: daysAgo(800),
    }).select("id").single();
    const { data: recent } = await admin.from("ai_usage_events").insert({
      workspace_id: ws.workspaceId, feature: "flow_ai_chat", model: "gpt-test", status: "success", created_at: daysAgo(5),
    }).select("id").single();

    const { data: count, error } = await admin.rpc("retention_delete_old_ai_usage_events", { p_cutoff: CUTOFF_730, p_batch_size: 1000 });
    if (error) throw new Error(error.message);
    expect(count as number).toBeGreaterThanOrEqual(1);

    expect((await admin.from("ai_usage_events").select("id").eq("id", old!.id).maybeSingle()).data).toBeNull();
    expect((await admin.from("ai_usage_events").select("id").eq("id", recent!.id).maybeSingle()).data).toBeTruthy();
  });
});

describe("Retention V1 - empty old conversations", () => {
  let ws: TestTenant;
  let numberId: string;

  beforeAll(async () => {
    ws = await createTestTenant("retention-conv");
    numberId = (await seedWhatsAppSetup(ws.workspaceId)).id;
  });
  afterAll(async () => cleanupTenant(ws));

  it("deletes an old conversation with zero remaining messages and no dependency", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { updated_at: daysAgo(800) });
    const { data: count, error } = await admin.rpc("retention_delete_empty_old_conversations", { p_cutoff: CUTOFF_730, p_batch_size: 200 });
    if (error) throw new Error(error.message);
    expect(count as number).toBeGreaterThanOrEqual(1);
    expect((await admin.from("inbox_conversations").select("id").eq("id", conv.id).maybeSingle()).data).toBeNull();
  });

  it("keeps an old conversation that still has a message", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { updated_at: daysAgo(800) });
    await seedInboxMessage(ws.workspaceId, conv.id, { created_at: daysAgo(5) });
    await admin.rpc("retention_delete_empty_old_conversations", { p_cutoff: CUTOFF_730, p_batch_size: 200 });
    expect((await admin.from("inbox_conversations").select("id").eq("id", conv.id).maybeSingle()).data).toBeTruthy();
  });

  it("keeps an old empty conversation a lead still references", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { updated_at: daysAgo(800) });
    await admin.from("leads").insert({ workspace_id: ws.workspaceId, human_reference: `RET-C-${Date.now()}`, source: "whatsapp", created_from_conversation_id: conv.id });
    await admin.rpc("retention_delete_empty_old_conversations", { p_cutoff: CUTOFF_730, p_batch_size: 200 });
    expect((await admin.from("inbox_conversations").select("id").eq("id", conv.id).maybeSingle()).data).toBeTruthy();
  });

  it("keeps an old empty conversation with an unresolved alert", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { updated_at: daysAgo(800) });
    await admin.from("inbox_alerts").insert({ workspace_id: ws.workspaceId, conversation_id: conv.id, alert_type: "high_priority", title: "still open", is_resolved: false });
    await admin.rpc("retention_delete_empty_old_conversations", { p_cutoff: CUTOFF_730, p_batch_size: 200 });
    expect((await admin.from("inbox_conversations").select("id").eq("id", conv.id).maybeSingle()).data).toBeTruthy();
  });
});

describe("Retention V1 - preview counts", () => {
  it("retention_preview_counts() returns the expected shape and only aggregate numbers", async () => {
    const { data, error } = await admin.rpc("retention_preview_counts");
    if (error) throw new Error(error.message);
    const keys = Object.keys(data as Record<string, unknown>).sort();
    expect(keys).toEqual([
      "ai_usage_events_older_than_730d",
      "blocked_by_claim",
      "blocked_by_dead_letter",
      "blocked_by_lead_attachment",
      "blocked_by_retry",
      "conversations_potentially_eligible_after_messages",
      "eligible_media_messages",
      "eligible_text_messages",
      "messages_older_than_730d",
      "resolved_alerts_older_than_90d",
      "terminal_automation_runs_older_than_180d",
    ]);
    for (const v of Object.values(data as Record<string, unknown>)) expect(typeof v).toBe("number");
  });
});
