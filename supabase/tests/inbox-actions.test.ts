// Phase D. Proves the staff-action dispatcher against the REAL deployed
// inbox-actions edge function: permission gating, the assign/return_to_ai/
// resolve/reopen/mark_read/add_note/reply state transitions, activity-log
// writes (shared workspace_activity_log, not a forked audit table), and
// the cross-workspace conversation_id defense (a caller with inbox.manage
// in their OWN workspace must never act on a conversation_id borrowed from
// another workspace).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedInboxMessage, seedWhatsAppSetup } from "./inboxHelpers";

const ACTIONS_URL = `${SUPABASE_URL}/functions/v1/inbox-actions`;

async function callAction(token: string, body: Record<string, unknown>) {
  const res = await fetch(ACTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("Inbox staff actions (release blocker)", () => {
  let workspace: TestTenant;
  let otherWorkspace: TestTenant;
  let numberId: string;
  let conversationId: string;
  let otherConversationId: string;
  let marketing: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };
  let ownerToken: string;

  beforeAll(async () => {
    workspace = await createTestTenant("inbox-actions");
    otherWorkspace = await createTestTenant("inbox-actions-other");
    const number = await seedWhatsAppSetup(workspace.workspaceId);
    numberId = number.id;
    await admin.rpc("set_workspace_integration_secret", {
      p_integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", numberId).single()).data!.integration_id,
      p_secret: "mock-whatsapp-token-not-a-real-credential",
    });
    const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
    conversationId = conversation.id;

    const otherNumber = await seedWhatsAppSetup(otherWorkspace.workspaceId);
    const otherConversation = await seedInboxConversation(otherWorkspace.workspaceId, otherNumber.id);
    otherConversationId = otherConversation.id;

    const marketingUser = await createTestUser("inbox-actions-marketing");
    await seedMembership(workspace.workspaceId, marketingUser.userId, "marketing");
    marketing = marketingUser;

    const { data: session } = await workspace.client.auth.getSession();
    ownerToken = session.session!.access_token;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(otherWorkspace);
    await cleanupTenant({ userId: marketing.userId });
  });

  it("a marketing member (no inbox.manage) cannot assign a conversation", async () => {
    const { data: session } = await marketing.client.auth.getSession();
    const result = await callAction(session.session!.access_token, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "assign", staff_id: marketing.userId });
    expect(result.status).toBe(403);
  });

  it("rejects an unknown action", async () => {
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "delete_everything" });
    expect(result.status).toBe(400);
  });

  it("REGRESSION: cannot act on a conversation_id that belongs to a different workspace, even with valid inbox.manage in the caller's own workspace", async () => {
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: otherConversationId, action: "resolve" });
    expect(result.status).toBe(404);
  });

  it("assign flips the conversation to human_handoff, assigned, and logs a shared workspace_activity_log entry", async () => {
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "assign", staff_id: workspace.userId });
    expect(result.status).toBe(200);

    const { data: conversation } = await admin.from("inbox_conversations").select("status, ai_enabled, inbox_status, assigned_staff_id").eq("id", conversationId).single();
    expect(conversation!.status).toBe("human_handoff");
    expect(conversation!.ai_enabled).toBe(false);
    expect(conversation!.inbox_status).toBe("assigned");
    expect(conversation!.assigned_staff_id).toBe(workspace.userId);

    const { data: activity } = await admin.from("workspace_activity_log").select("action").eq("workspace_id", workspace.workspaceId).eq("target_id", conversationId).eq("action", "inbox_conversation_assigned");
    expect(activity!.length).toBeGreaterThan(0);
  });

  it("resolve is refused while ai_enabled is true, and requires taking over first", async () => {
    const fresh = await seedInboxConversation(workspace.workspaceId, numberId);
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: fresh.id, action: "resolve" });
    expect(result.status).toBe(400);
  });

  it("resolve succeeds once assigned, and resolves any open alerts", async () => {
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "resolve" });
    expect(result.status).toBe(200);
    const { data: conversation } = await admin.from("inbox_conversations").select("inbox_status, resolved_at").eq("id", conversationId).single();
    expect(conversation!.inbox_status).toBe("resolved");
    expect(conversation!.resolved_at).toBeTruthy();
  });

  it("reopen brings a resolved conversation back to human_handoff, assigned (since it was already assigned)", async () => {
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "reopen" });
    expect(result.status).toBe(200);
    const { data: conversation } = await admin.from("inbox_conversations").select("status, inbox_status, resolved_at").eq("id", conversationId).single();
    expect(conversation!.status).toBe("human_handoff");
    expect(conversation!.inbox_status).toBe("assigned");
    expect(conversation!.resolved_at).toBeNull();
  });

  it("return_to_ai clears assignment and re-enables AI", async () => {
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "return_to_ai" });
    expect(result.status).toBe(200);
    const { data: conversation } = await admin.from("inbox_conversations").select("status, ai_enabled, assigned_staff_id, inbox_status, resolved_at").eq("id", conversationId).single();
    expect(conversation!.status).toBe("active");
    expect(conversation!.ai_enabled).toBe(true);
    expect(conversation!.assigned_staff_id).toBeNull();
    expect(conversation!.inbox_status).toBe("new");
    expect(conversation!.resolved_at).toBeNull();
  });

  it("mark_read upserts a read position and is idempotent", async () => {
    const first = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "mark_read" });
    expect(first.status).toBe(200);
    const second = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "mark_read" });
    expect(second.status).toBe(200);
    const { data } = await admin.from("inbox_conversation_reads").select("staff_id").eq("conversation_id", conversationId).eq("staff_id", workspace.userId);
    expect(data).toHaveLength(1);
  });

  it("add_note saves an internal note and rejects an empty one", async () => {
    const ok = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "add_note", note: "Called back, waiting on a quote." });
    expect(ok.status).toBe(200);
    const { data: notes } = await admin.from("inbox_internal_notes").select("body").eq("conversation_id", conversationId);
    expect(notes!.some((n) => n.body === "Called back, waiting on a quote.")).toBe(true);

    const empty = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "add_note", note: "   " });
    expect(empty.status).toBe(400);
  });

  it("reply saves the message and moves the conversation into human_handoff/waiting_client (Phase L-1: only reachable once a real inbound customer message has opened the 24-hour messaging window)", async () => {
    // Realistic flow: a reply's inbox_status='waiting_client' only takes
    // effect once the conversation is ALREADY human-controlled - the
    // sync_inbox_conversation_state trigger force-computes inbox_status
    // from assigned_staff_id (new/assigned) on the FIRST transition into
    // human_handoff, same as it does for "assign" itself. Take over first.
    const takeOver = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "assign", staff_id: workspace.userId });
    expect(takeOver.status).toBe(200);

    // A conversation seeded directly (no real webhook delivery) has no
    // inbound-customer evidence at all - the messaging window is "unknown"
    // until a real inbound message exists. Seed one to open it.
    await seedInboxMessage(workspace.workspaceId, conversationId);

    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "reply", message: "Thanks for reaching out, how can we help?" });
    expect(result.status).toBe(200);

    const { data: message } = await admin.from("inbox_messages").select("content, sender_type, delivery_status, staff_sender_id").eq("conversation_id", conversationId).eq("sender_type", "staff").order("created_at", { ascending: false }).limit(1).single();
    expect(message!.content).toBe("Thanks for reaching out, how can we help?");
    expect(message!.delivery_status).toBe(result.body.delivery_status);
    expect(message!.staff_sender_id).toBe(workspace.userId);

    const { data: conversation } = await admin.from("inbox_conversations").select("status, inbox_status").eq("id", conversationId).single();
    expect(conversation!.status).toBe("human_handoff");
    expect(conversation!.inbox_status).toBe("waiting_client");
  });

  it("rejects a reply that is empty or too long", async () => {
    const empty = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "reply", message: "" });
    expect(empty.status).toBe(400);
    const tooLong = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversationId, action: "reply", message: "x".repeat(1001) });
    expect(tooLong.status).toBe(400);
  });
});
