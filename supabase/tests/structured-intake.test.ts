// Phase 3 - Structured Intake + Real Ask Info. Exercises the REAL local
// intake-actions and inbox-actions edge functions plus RLS on the two new
// definition tables. No OpenAI and no real WhatsApp send is ever involved:
// the AI extraction path is covered by the pure-engine unit tests
// (supabase/functions/_shared/inbox/intakeSchema.test.ts); here the
// completion transition is driven deterministically through the manual
// set_intake_answer action, and every ask_info send runs against a fake
// token so it can only ever hit the provider FAILURE path.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedInboxMessage, seedWhatsAppSetup } from "./inboxHelpers";

const INTAKE_URL = `${SUPABASE_URL}/functions/v1/intake-actions`;
const INBOX_URL = `${SUPABASE_URL}/functions/v1/inbox-actions`;
const LEADS_URL = `${SUPABASE_URL}/functions/v1/leads-actions`;

async function callIntake(token: string, body: Record<string, unknown>) {
  const res = await fetch(INTAKE_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function callInbox(token: string, body: Record<string, unknown>) {
  const res = await fetch(INBOX_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function callLeads(token: string, body: Record<string, unknown>) {
  const res = await fetch(LEADS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

/** Seed a schema + ordered fields directly (service role) - the fast path
 * for tests that only need the state, not the create_* dispatcher. */
async function seedSchema(workspaceId: string, opts: { name?: string; isDefault?: boolean } = {}) {
  // Only one row per workspace may carry is_default (partial unique index) -
  // clear any existing default first, exactly as set_default_schema does.
  if (opts.isDefault) {
    await admin.from("workspace_intake_schemas").update({ is_default: false }).eq("workspace_id", workspaceId).eq("is_default", true);
  }
  const { data, error } = await admin.from("workspace_intake_schemas").insert({
    workspace_id: workspaceId, name: opts.name ?? "Test intake", is_default: opts.isDefault ?? false, is_active: true,
  }).select("id").single();
  if (error || !data) throw new Error(`seedSchema failed: ${error?.message}`);
  return data.id as string;
}
async function seedField(schemaId: string, workspaceId: string, f: Record<string, unknown>) {
  const { data, error } = await admin.from("workspace_intake_fields").insert({ schema_id: schemaId, workspace_id: workspaceId, ...f }).select("id").single();
  if (error || !data) throw new Error(`seedField failed: ${error?.message}`);
  return data.id as string;
}

async function intakeEventCount(conversationId: string) {
  const { count } = await admin
    .from("domain_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "conversation.intake_completed")
    .eq("entity_id", conversationId);
  return count ?? 0;
}

describe("Phase 3 - structured intake + Ask Info", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let numberId: string;
  let ownerToken: string;
  let otherOwnerToken: string;
  let salesClient: import("@supabase/supabase-js").SupabaseClient;
  let salesUserId: string;

  beforeAll(async () => {
    ws = await createTestTenant("intake");
    other = await createTestTenant("intake-other");

    const number = await seedWhatsAppSetup(ws.workspaceId);
    numberId = number.id;
    await admin.rpc("set_workspace_integration_secret", {
      p_integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", numberId).single()).data!.integration_id,
      p_secret: "mock-whatsapp-token-not-a-real-credential",
    });
    await seedWhatsAppSetup(other.workspaceId);

    ownerToken = (await ws.client.auth.getSession()).data.session!.access_token;
    otherOwnerToken = (await other.client.auth.getSession()).data.session!.access_token;

    const sales = await createTestUser("intake-sales");
    await seedMembership(ws.workspaceId, sales.userId, "sales");
    salesClient = sales.client;
    salesUserId = sales.userId;
  });

  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
    await cleanupTenant({ userId: salesUserId });
  });

  // --- RLS / tenant isolation --------------------------------------------

  it("workspace A cannot read workspace B's intake schemas via RLS", async () => {
    const bSchema = await seedSchema(other.workspaceId, { name: "B private" });
    const { data: viaA } = await ws.client.from("workspace_intake_schemas").select("id").eq("id", bSchema);
    expect(viaA ?? []).toHaveLength(0);
    const { data: viaB } = await other.client.from("workspace_intake_schemas").select("id").eq("id", bSchema);
    expect((viaB ?? []).map((r) => r.id)).toContain(bSchema);
  });

  it("workspace A cannot mutate workspace B's schema through intake-actions", async () => {
    const bSchema = await seedSchema(other.workspaceId, { name: "B private 2" });
    const res = await callIntake(ownerToken, { workspace_id: ws.workspaceId, action: "update_schema", schema_id: bSchema, name: "hijacked" });
    expect(res.status).toBe(404);
    const { data } = await admin.from("workspace_intake_schemas").select("name").eq("id", bSchema).single();
    expect(data!.name).toBe("B private 2");
  });

  it("two workspaces keep entirely separate schema lists", async () => {
    await seedSchema(ws.workspaceId, { name: "A only" });
    const a = await callIntake(ownerToken, { workspace_id: ws.workspaceId, action: "list" });
    const b = await callIntake(otherOwnerToken, { workspace_id: other.workspaceId, action: "list" });
    const aNames = a.body.schemas.map((s: { name: string }) => s.name);
    const bNames = b.body.schemas.map((s: { name: string }) => s.name);
    expect(aNames).toContain("A only");
    expect(bNames).not.toContain("A only");
  });

  // --- role permission enforcement -------------------------------------

  it("a sales member (intake.view, no intake.manage) can list but not create a schema", async () => {
    const token = (await salesClient.auth.getSession()).data.session!.access_token;
    const list = await callIntake(token, { workspace_id: ws.workspaceId, action: "list" });
    expect(list.status).toBe(200);
    const create = await callIntake(token, { workspace_id: ws.workspaceId, action: "create_schema", name: "sales tried" });
    expect(create.status).toBe(403);
  });

  // --- schema / field CRUD via the dispatcher --------------------------

  it("create_schema makes the first schema the default; a field key cannot be changed once created", async () => {
    const fresh = await createTestTenant("intake-crud");
    const t = (await fresh.client.auth.getSession()).data.session!.access_token;
    const created = await callIntake(t, { workspace_id: fresh.workspaceId, action: "create_schema", name: "First" });
    expect(created.status).toBe(200);
    expect(created.body.is_default).toBe(true);

    const f = await callIntake(t, {
      workspace_id: fresh.workspaceId, action: "create_field", schema_id: created.body.schema_id,
      key: "full_name", label: "Full name", question_text: "Your name?", field_type: "text", required: true,
    });
    expect(f.status).toBe(200);
    const rename = await callIntake(t, { workspace_id: fresh.workspaceId, action: "update_field", field_id: f.body.field_id, key: "renamed" });
    expect(rename.status).toBe(400);
    await cleanupTenant(fresh);
  });

  // --- ordered evaluation + completion event --------------------------

  it("set_intake_answer follows sort_order, keeps invalid answers missing, and emits conversation.intake_completed exactly once", async () => {
    const schemaId = await seedSchema(ws.workspaceId, { name: "Completion", isDefault: true });
    await seedField(schemaId, ws.workspaceId, { key: "full_name", label: "Full name", question_text: "Your full name?", field_type: "text", required: true, sort_order: 10 });
    await seedField(schemaId, ws.workspaceId, { key: "email", label: "Email", question_text: "Best email?", field_type: "email", required: true, sort_order: 20 });
    await seedField(schemaId, ws.workspaceId, { key: "notes", label: "Notes", question_text: "Anything else?", field_type: "textarea", required: false, sort_order: 30 });

    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831240001", wa_id: "27831240001" });

    // invalid email -> stays missing, next question is still the email one
    const bad = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_intake_answer", field_key: "email", value: "not-an-email" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("invalid_field_value");

    const step1 = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_intake_answer", field_key: "full_name", value: "Ada Lovelace" });
    expect(step1.status).toBe(200);
    expect(step1.body.evaluation.complete).toBe(false);
    expect(step1.body.evaluation.missing_required).toEqual(["email"]);
    expect(await intakeEventCount(conv.id)).toBe(0);

    const step2 = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_intake_answer", field_key: "email", value: "ada@example.com" });
    expect(step2.status).toBe(200);
    expect(step2.body.evaluation.complete).toBe(true);
    expect(await intakeEventCount(conv.id)).toBe(1);

    // replay: same call again -> no duplicate event
    await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_intake_answer", field_key: "email", value: "ada@example.com" });
    expect(await intakeEventCount(conv.id)).toBe(1);

    // stored shape is the canonical { schema_id, fields }
    const { data: row } = await admin.from("inbox_conversations").select("intake_payload, intake_schema_id, intake_completed_at").eq("id", conv.id).single();
    expect((row!.intake_payload as { schema_id: string }).schema_id).toBe(schemaId);
    expect((row!.intake_payload as { fields: Record<string, unknown> }).fields).toMatchObject({ full_name: "Ada Lovelace", email: "ada@example.com" });
    expect(row!.intake_completed_at).toBeTruthy();
  });

  it("concurrent completing writes still produce exactly one completion event", async () => {
    const schemaId = await seedSchema(ws.workspaceId, { name: "Race" });
    await seedField(schemaId, ws.workspaceId, { key: "only_field", label: "Only", question_text: "One thing?", field_type: "text", required: true, sort_order: 10 });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831240002", wa_id: "27831240002", intake_schema_id: schemaId });

    await Promise.all([
      callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_intake_answer", field_key: "only_field", value: "done A" }),
      callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_intake_answer", field_key: "only_field", value: "done B" }),
    ]);
    expect(await intakeEventCount(conv.id)).toBe(1);
  });

  it("schema edit does not erase a stored answer", async () => {
    const schemaId = await seedSchema(ws.workspaceId, { name: "Edit safety" });
    const fieldId = await seedField(schemaId, ws.workspaceId, { key: "keep_me", label: "Keep me", question_text: "?", field_type: "text", required: true, sort_order: 10 });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831240003", wa_id: "27831240003", intake_schema_id: schemaId });

    await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_intake_answer", field_key: "keep_me", value: "precious" });
    await callIntake(ownerToken, { workspace_id: ws.workspaceId, action: "delete_field", field_id: fieldId });

    const { data: row } = await admin.from("inbox_conversations").select("intake_payload").eq("id", conv.id).single();
    expect((row!.intake_payload as { fields: Record<string, unknown> }).fields.keep_me).toBe("precious");
  });

  // --- Real Ask Info ---------------------------------------------------

  it("ask_info preview never sends a message; it only reports the next question", async () => {
    const schemaId = await seedSchema(ws.workspaceId, { name: "Ask preview" });
    await seedField(schemaId, ws.workspaceId, { key: "budget", label: "Budget", question_text: "What is your budget?", field_type: "currency", required: true, sort_order: 10 });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831240004", wa_id: "27831240004", intake_schema_id: schemaId });

    const before = await admin.from("inbox_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("direction", "outbound");
    const preview = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "ask_info", confirm: false });
    expect(preview.status).toBe(200);
    expect(preview.body.next_question).toBe("What is your budget?");
    expect(preview.body.field_key).toBe("budget");
    const after = await admin.from("inbox_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("direction", "outbound");
    expect(after.count ?? 0).toBe(before.count ?? 0);
  });

  it("ask_info confirm outside the 24h window is refused with messaging_window_closed (no send)", async () => {
    const schemaId = await seedSchema(ws.workspaceId, { name: "Ask window" });
    await seedField(schemaId, ws.workspaceId, { key: "topic", label: "Topic", question_text: "What do you need help with?", field_type: "text", required: true, sort_order: 10 });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831240005", wa_id: "27831240005", intake_schema_id: schemaId });
    // an inbound message > 24h old => window closed
    await seedInboxMessage(ws.workspaceId, conv.id, { created_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString() });

    const res = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "ask_info", confirm: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("messaging_window_closed");
  });

  it("ask_info confirm inside the window records an outbound question and never a real send (fake token -> failed/submitted only)", async () => {
    const schemaId = await seedSchema(ws.workspaceId, { name: "Ask send" });
    await seedField(schemaId, ws.workspaceId, { key: "company", label: "Company", question_text: "Which company are you with?", field_type: "text", required: true, sort_order: 10 });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831240006", wa_id: "27831240006", intake_schema_id: schemaId });
    await seedInboxMessage(ws.workspaceId, conv.id, { created_at: new Date().toISOString() }); // fresh inbound -> window open

    const res = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "ask_info", confirm: true });
    expect(res.status).toBe(200);
    const { data: msgs } = await admin.from("inbox_messages").select("content, sender_type, delivery_status, direction").eq("conversation_id", conv.id).eq("direction", "outbound");
    expect(msgs).toHaveLength(1);
    expect(msgs![0].content).toBe("Which company are you with?");
    expect(msgs![0].sender_type).toBe("ai");
    expect(["failed", "submitted"]).toContain(msgs![0].delivery_status);
  });

  // --- no-schema fallback -------------------------------------------

  it("a conversation in a workspace with no active schema keeps working (ask_info reports no schema)", async () => {
    const bare = await createTestTenant("intake-bare");
    const bareNumber = await seedWhatsAppSetup(bare.workspaceId);
    const t = (await bare.client.auth.getSession()).data.session!.access_token;
    const conv = await seedInboxConversation(bare.workspaceId, bareNumber.id, { phone_number: "+27831240007", wa_id: "27831240007" });
    const res = await callInbox(t, { workspace_id: bare.workspaceId, conversation_id: conv.id, action: "ask_info", confirm: false });
    expect(res.status).toBe(200);
    expect(res.body.has_schema).toBe(false);
    expect(res.body.next_question).toBeNull();
    await cleanupTenant(bare);
  });

  // --- Phase 2 handoff preserved ----------------------------------

  it("Phase 2 conversion still copies structured intake ({ schema_id, fields }) onto the lead", async () => {
    const schemaId = await seedSchema(ws.workspaceId, { name: "Handoff" });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      phone_number: "+27831240008", wa_id: "27831240008", display_name: "Handoff Lead", ai_summary: "wants equipment finance",
      intake_payload: { schema_id: schemaId, fields: { full_name: "Grace Hopper", email: "grace@example.com", amount_required: 500000 } },
    });

    const created = await callLeads(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(created.status).toBe(200);
    const { data: leadRow } = await admin.from("leads").select("intake, contact_name, email, summary").eq("id", (created.body.lead as { id: string }).id).single();
    expect((leadRow!.intake as { schema_id: string }).schema_id).toBe(schemaId);
    expect((leadRow!.intake as { fields: Record<string, unknown> }).fields).toMatchObject({ full_name: "Grace Hopper", email: "grace@example.com" });
    // safe typed-field mapping still reads through the nested `fields` view
    expect(leadRow!.contact_name).toBe("Handoff Lead"); // display_name wins for contact_name
    expect(leadRow!.email).toBe("grace@example.com");
    expect(leadRow!.summary).toBe("wants equipment finance");
  });

  // --- M1: zero-required-field schema never completes ----------------

  it("a schema with no required fields never emits conversation.intake_completed", async () => {
    const schemaId = await seedSchema(ws.workspaceId, { name: "All optional" });
    await seedField(schemaId, ws.workspaceId, { key: "pref_channel", label: "Preferred channel", question_text: "How should we reach you?", field_type: "text", required: false, sort_order: 10 });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831240009", wa_id: "27831240009", intake_schema_id: schemaId });

    const res = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_intake_answer", field_key: "pref_channel", value: "WhatsApp is fine" });
    expect(res.status).toBe(200);
    expect(res.body.evaluation.complete).toBe(false);
    expect(await intakeEventCount(conv.id)).toBe(0);

    const { data: row } = await admin.from("inbox_conversations").select("intake_completed_at").eq("id", conv.id).single();
    expect(row!.intake_completed_at).toBeNull();

    // ask_info also reports nothing to ask and not complete
    const preview = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "ask_info", confirm: false });
    expect(preview.body.next_question).toBeNull();
    expect(preview.body.complete).toBe(false);
  });

  // --- M2: an in-flight conversation stays pinned to its schema -------

  it("a conversation stays on the schema it started with after the workspace default changes", async () => {
    const schemaA = await seedSchema(ws.workspaceId, { name: "Pinned A", isDefault: true });
    await seedField(schemaA, ws.workspaceId, { key: "a_one", label: "A one", question_text: "A: first thing?", field_type: "text", required: true, sort_order: 10 });
    await seedField(schemaA, ws.workspaceId, { key: "a_two", label: "A two", question_text: "A: second thing?", field_type: "text", required: true, sort_order: 20 });

    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831240010", wa_id: "27831240010" });
    // first answer resolves + pins schema A (no intake_schema_id column yet)
    const first = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_intake_answer", field_key: "a_one", value: "answered" });
    expect(first.status).toBe(200);
    expect(first.body.evaluation.missing_required).toEqual(["a_two"]);
    const { data: pinned } = await admin.from("inbox_conversations").select("intake_schema_id").eq("id", conv.id).single();
    expect(pinned!.intake_schema_id).toBe(schemaA);

    // workspace switches its default to a brand-new schema B
    const schemaB = await seedSchema(ws.workspaceId, { name: "New default B" });
    await seedField(schemaB, ws.workspaceId, { key: "b_one", label: "B one", question_text: "B: only thing?", field_type: "text", required: true, sort_order: 10 });
    const setDefault = await callIntake(ownerToken, { workspace_id: ws.workspaceId, action: "set_default_schema", schema_id: schemaB });
    expect(setDefault.status).toBe(200);

    // the conversation still evaluates against A, not B
    const preview = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "ask_info", confirm: false });
    expect(preview.body.field_key).toBe("a_two");
    // and a B-only field is rejected for this conversation
    const wrongSchemaField = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_intake_answer", field_key: "b_one", value: "x" });
    expect(wrongSchemaField.status).toBe(400);
  });

  // --- L2: per-number schema cannot cross workspaces ----------------

  it("set_number_schema rejects a schema that belongs to another workspace", async () => {
    const foreignSchema = await seedSchema(other.workspaceId, { name: "Not yours" });
    const res = await callIntake(ownerToken, { workspace_id: ws.workspaceId, action: "set_number_schema", whatsapp_number_id: numberId, schema_id: foreignSchema });
    expect(res.status).toBe(404);
    const { data: num } = await admin.from("workspace_whatsapp_numbers").select("intake_schema_id").eq("id", numberId).single();
    expect(num!.intake_schema_id).not.toBe(foreignSchema);
  });

  // --- L3: Ask Info / answer edit enforce inbox.manage --------------

  it("ask_info and set_intake_answer refuse a caller without inbox.manage", async () => {
    const schemaId = await seedSchema(ws.workspaceId, { name: "Perm gate" });
    await seedField(schemaId, ws.workspaceId, { key: "thing", label: "Thing", question_text: "?", field_type: "text", required: true, sort_order: 10 });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831240011", wa_id: "27831240011", intake_schema_id: schemaId });
    const salesToken = (await salesClient.auth.getSession()).data.session!.access_token;

    const ask = await callInbox(salesToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "ask_info", confirm: false });
    expect(ask.status).toBe(403);
    const edit = await callInbox(salesToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "set_intake_answer", field_key: "thing", value: "y" });
    expect(edit.status).toBe(403);
  });
});
