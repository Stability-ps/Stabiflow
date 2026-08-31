// Phase 2 - Conversation -> CRM completion. Proves, against the real
// leads-actions edge function + local Postgres, that the context the AI
// collected on a WhatsApp conversation (ai_summary, intake_payload,
// inbox-media attachments) travels onto the lead it becomes / is linked
// to - workspace-scoped, RLS-enforced, permission-gated, and NEVER
// fabricating a summary, guessing an ambiguous value, or copying bytes.
//
// leads-actions makes no provider calls (no Meta, no WhatsApp send, no
// OpenAI), so there is nothing to mock here - the "no provider mutation"
// requirement is satisfied structurally.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedInboxMessage, seedWhatsAppSetup } from "./inboxHelpers";
import { seedLead } from "./leadsHelpers";

const ACTIONS_URL = `${SUPABASE_URL}/functions/v1/leads-actions`;

async function call(token: string, body: Record<string, unknown>) {
  const res = await fetch(ACTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function tokenFor(t: { client: SupabaseClient }) {
  const { data } = await t.client.auth.getSession();
  return data.session!.access_token;
}

// Seed an inbound media message AND put a real (tiny) object at its
// storage path so a signed URL can actually be minted.
async function seedMediaMessage(workspaceId: string, conversationId: string, filename: string, mime = "application/pdf") {
  const path = `${workspaceId}/${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`;
  const bytes = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: mime });
  const { error: upErr } = await admin.storage.from("inbox-media").upload(path, bytes, { contentType: mime, upsert: true });
  if (upErr) throw new Error(`inbox-media upload failed: ${upErr.message}`);
  const id = await seedInboxMessage(workspaceId, conversationId, {
    message_type: mime === "application/pdf" ? "document" : "image",
    content: "[Document attached]",
    media_storage_path: path,
    media_mime_type: mime,
    media_filename: filename,
    media_size_bytes: 8,
  });
  return { id, path };
}

describe("Conversation -> CRM completion (Phase 2)", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let ownerToken: string;
  let numberId: string;
  let support: { userId: string; client: SupabaseClient }; // lead.view + lead.create, NOT lead.edit
  let viewer: { userId: string; client: SupabaseClient }; // lead.view only

  beforeAll(async () => {
    ws = await createTestTenant("crm-completion");
    other = await createTestTenant("crm-completion-other");
    numberId = (await seedWhatsAppSetup(ws.workspaceId)).id;
    ownerToken = await tokenFor(ws);

    const s = await createTestUser("crm-completion-support");
    await seedMembership(ws.workspaceId, s.userId, "support");
    support = s;
    const v = await createTestUser("crm-completion-viewer");
    await seedMembership(ws.workspaceId, v.userId, "viewer");
    viewer = v;
  });

  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
    await cleanupTenant({ userId: support.userId });
    await cleanupTenant({ userId: viewer.userId });
  });

  it("K1/K2/K4/K5/K13/K14: create_from_conversation makes exactly ONE lead, copies the AI summary, preserves intake, maps safe typed fields, backfills attribution and sets conversation.lead_id", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      display_name: "Nomsa Dlamini",
      phone_number: "+27831230001",
      wa_id: "27831230001",
      ai_summary: "Wants a quote for 20 solar panels, installed in Durban, budget flexible.",
      intake_payload: { customer_name: "Nomsa Dlamini", email: "NOMSA@example.com", company_name: "Dlamini Energy", urgency: "high", budget: 40000 },
    });
    // attribution touchpoint recorded on the conversation
    await admin.from("attribution_events").insert({
      workspace_id: ws.workspaceId, conversation_id: conv.id, event_type: "touchpoint", platform: "meta",
      occurred_at: new Date().toISOString(), source_type: "paid", attribution_method: "deterministic", attribution_confidence: "exact",
    });

    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(true);

    const { data: leads } = await admin.from("leads").select("id, summary, intake, contact_name, email, company_name, estimated_value").eq("created_from_conversation_id", conv.id);
    expect(leads).toHaveLength(1); // exactly one
    const lead = leads![0];
    expect(lead.summary).toBe("Wants a quote for 20 solar panels, installed in Durban, budget flexible.");
    expect(lead.intake).toMatchObject({ customer_name: "Nomsa Dlamini", email: "NOMSA@example.com", urgency: "high", budget: 40000 });
    expect(lead.contact_name).toBe("Nomsa Dlamini"); // already set from display_name
    expect(lead.email).toBe("nomsa@example.com"); // safe map from intake
    expect(lead.company_name).toBe("Dlamini Energy"); // safe map from intake
    expect(lead.estimated_value).toBeNull(); // "budget" is ambiguous - NEVER guessed

    const { data: linkedConv } = await admin.from("inbox_conversations").select("lead_id").eq("id", conv.id).single();
    expect(linkedConv!.lead_id).toBe(lead.id);
    const { data: attr } = await admin.from("attribution_events").select("lead_id").eq("conversation_id", conv.id);
    expect(attr!.every((a) => a.lead_id === lead.id)).toBe(true); // additive backfill intact
  });

  it("K3: a conversation with NO ai_summary produces a lead with a null summary - never fabricated", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { display_name: "No Summary", phone_number: "+27831230002", wa_id: "27831230002", intake_payload: { interest_summary: "just browsing" } });
    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(r.status).toBe(200);
    const { data: lead } = await admin.from("leads").select("summary, intake").eq("id", r.body.lead.id).single();
    expect(lead!.summary).toBeNull();
    expect(lead!.intake).toMatchObject({ interest_summary: "just browsing" }); // still preserved in intake
  });

  it("K7/K8/K9: inbound media is LINKED (references the existing object, no byte copy); re-running does not duplicate; multiple items map 1:1", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { display_name: "Docs Sender", phone_number: "+27831230003", wa_id: "27831230003" });
    const m1 = await seedMediaMessage(ws.workspaceId, conv.id, "sars-letter.pdf");
    const m2 = await seedMediaMessage(ws.workspaceId, conv.id, "id.jpg", "image/jpeg");
    await seedInboxMessage(ws.workspaceId, conv.id, { content: "and here is the context" }); // a text message - must NOT become an attachment

    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(r.status).toBe(200);
    expect(r.body.context.attachments_linked).toBe(2);

    const { data: atts } = await admin.from("lead_attachments").select("storage_path, message_id, media_filename, source").eq("lead_id", r.body.lead.id).order("received_at");
    expect(atts).toHaveLength(2);
    expect(atts!.map((a) => a.storage_path).sort()).toEqual([m1.path, m2.path].sort()); // points at the SAME objects
    expect(atts!.map((a) => a.message_id).sort()).toEqual([m1.id, m2.id].sort());
    expect(atts!.every((a) => a.source === "whatsapp_conversation")).toBe(true);

    // Re-link the same conversation to the same lead - no new attachment rows.
    const relink = await call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: r.body.lead.id, conversation_id: conv.id });
    expect(relink.status).toBe(200);
    expect(relink.body.context.attachments_linked).toBe(0);
    const { count } = await admin.from("lead_attachments").select("id", { count: "exact", head: true }).eq("lead_id", r.body.lead.id);
    expect(count).toBe(2);
  });

  it("K18: sign_lead_attachment returns a usable signed URL; a bogus id fails safely with 404", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230004", wa_id: "27831230004" });
    await seedMediaMessage(ws.workspaceId, conv.id, "quote.pdf");
    const created = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    const { data: att } = await admin.from("lead_attachments").select("id").eq("lead_id", created.body.lead.id).single();

    const signed = await call(ownerToken, { workspace_id: ws.workspaceId, action: "sign_lead_attachment", attachment_id: att!.id });
    expect(signed.status).toBe(200);
    expect(typeof signed.body.url).toBe("string");
    expect(signed.body.url).toContain("/storage/v1/object/sign/inbox-media/");
    expect(signed.body.url).toContain("token=");
    // The edge function runs inside Docker, so createSignedUrl builds the URL
    // against the internal gateway host ("kong:8000"); rewrite it to the
    // host-reachable address to prove the token actually resolves to the object.
    const reachable = signed.body.url.replace(/^https?:\/\/[^/]+/, SUPABASE_URL);
    const head = await fetch(reachable, { method: "GET" });
    expect(head.ok).toBe(true); // the signed URL actually resolves to the stored object

    const missing = await call(ownerToken, { workspace_id: ws.workspaceId, action: "sign_lead_attachment", attachment_id: "00000000-0000-0000-0000-000000000000" });
    expect(missing.status).toBe(404);
  });

  it("K10/K22: workspace A cannot read workspace B's lead_attachments, and cannot sign one via a cross-workspace id", async () => {
    // Build a lead + attachment in workspace `ws`.
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230005", wa_id: "27831230005" });
    await seedMediaMessage(ws.workspaceId, conv.id, "private.pdf");
    const created = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    const { data: att } = await admin.from("lead_attachments").select("id").eq("lead_id", created.body.lead.id).single();

    // Workspace B's owner reads lead_attachments via RLS -> sees nothing of ws's.
    const { data: seenByB } = await other.client.from("lead_attachments").select("id");
    expect((seenByB || []).some((a) => a.id === att!.id)).toBe(false);

    // Workspace B's owner tries to sign ws's attachment by passing their OWN workspace_id -> 404 (chain re-checked server-side).
    const otherToken = await tokenFor(other);
    const crossSign = await call(otherToken, { workspace_id: other.workspaceId, action: "sign_lead_attachment", attachment_id: att!.id });
    expect(crossSign.status).toBe(404);
  });

  it("K22: cannot attach a conversation from workspace B to a lead in workspace A", async () => {
    const leadInWs = await seedLead(ws.workspaceId, {});
    const otherNumberId = (await seedWhatsAppSetup(other.workspaceId)).id;
    const convInOther = await seedInboxConversation(other.workspaceId, otherNumberId, { phone_number: "+27899990001", wa_id: "27899990001" });
    // caller is ws's owner, lead is in ws, conversation is in `other` -> conversation not found in ws
    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: leadInWs.id, conversation_id: convInOther.id });
    expect(r.status).toBe(404);
  });

  it("K11: duplicate detection still surfaces an existing lead by phone (create_from_conversation, no force)", async () => {
    // First conversation -> a real lead (phone_normalized computed the same
    // way the second call will compute it). Second conversation, same phone
    // -> duplicate, no second lead.
    const first = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230006", wa_id: "27831230006a", ai_summary: "first" });
    const firstRes = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: first.id });
    expect(firstRes.body.created).toBe(true);

    const second = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230006", wa_id: "27831230006b", ai_summary: "second" });
    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: second.id });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(false);
    expect(r.body.duplicates.length).toBeGreaterThan(0);
    expect(r.body.duplicates[0].id).toBe(firstRes.body.lead.id);
  });

  it("K12: linking a conversation to an EXISTING lead does NOT overwrite its summary or intake keys (existing wins); attachments are still added", async () => {
    const lead = await seedLead(ws.workspaceId, { summary: "Curated by the sales team.", intake: { urgency: "low", owner_note: "hot lead" } });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      phone_number: "+27831230007", wa_id: "27831230007",
      ai_summary: "AI's different version of events.",
      intake_payload: { urgency: "high", customer_name: "Sipho", email: "sipho@x.io" },
    });
    await seedMediaMessage(ws.workspaceId, conv.id, "attach-on-link.pdf");

    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: lead.id, conversation_id: conv.id });
    expect(r.status).toBe(200);
    expect(r.body.context.summary_skipped).toBe(true);
    expect(r.body.context.summary_copied).toBe(false);
    expect(r.body.context.attachments_linked).toBe(1);

    const { data: after } = await admin.from("leads").select("summary, intake").eq("id", lead.id).single();
    expect(after!.summary).toBe("Curated by the sales team."); // NOT overwritten
    expect(after!.intake).toMatchObject({ urgency: "low", owner_note: "hot lead", customer_name: "Sipho", email: "sipho@x.io" }); // existing keys kept, new keys added
  });

  it("K12b: overwrite_summary is an EXPLICIT opt-in that replaces a non-empty lead summary", async () => {
    const lead = await seedLead(ws.workspaceId, { summary: "Old summary." });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230008", wa_id: "27831230008", ai_summary: "Replacement summary." });
    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: lead.id, conversation_id: conv.id, overwrite_summary: true });
    expect(r.status).toBe(200);
    expect(r.body.context.summary_overwritten).toBe(true);
    const { data: after } = await admin.from("leads").select("summary").eq("id", lead.id).single();
    expect(after!.summary).toBe("Replacement summary.");
  });

  it("apply_context:false links the conversation but copies nothing", async () => {
    const lead = await seedLead(ws.workspaceId, {});
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230009", wa_id: "27831230009", ai_summary: "should not be copied" });
    await seedMediaMessage(ws.workspaceId, conv.id, "skip.pdf");
    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: lead.id, conversation_id: conv.id, apply_context: false });
    expect(r.status).toBe(200);
    expect(r.body.context).toBeNull();
    const { data: after } = await admin.from("leads").select("summary").eq("id", lead.id).single();
    expect(after!.summary).toBeNull();
    const { count } = await admin.from("lead_attachments").select("id", { count: "exact", head: true }).eq("lead_id", lead.id);
    expect(count).toBe(0);
  });

  it("K15: create_opportunity from the conversation's lead uses the existing action path and emits opportunity.created", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { display_name: "Opp Lead", phone_number: "+27831230010", wa_id: "27831230010", ai_summary: "wants the enterprise plan" });
    const created = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    const leadId = created.body.lead.id;

    const opp = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_opportunity", lead_id: leadId, title: "Opp Lead - deal", estimated_value: 25000 });
    expect(opp.status).toBe(200);
    expect(opp.body.opportunity.lead_id).toBe(leadId);
    expect(Number(opp.body.opportunity.estimated_value)).toBe(25000);

    const { data: events } = await admin.from("domain_events").select("event_type").eq("workspace_id", ws.workspaceId).eq("entity_id", opp.body.opportunity.id);
    expect(events!.some((e) => e.event_type === "opportunity.created")).toBe(true);
  });

  it("K16: partial-permission gating - support (lead.view + lead.create, NO lead.edit / opportunity.create) may create but not link or open an opportunity", async () => {
    const supportToken = await tokenFor(support);
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { display_name: "Support Made", phone_number: "+27831230013", wa_id: "27831230013", ai_summary: "support can create this" });

    const created = await call(supportToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(created.status).toBe(200);
    expect(created.body.created).toBe(true);
    const leadId = created.body.lead.id;

    const conv2 = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230014", wa_id: "27831230014" });
    const linkBySupport = await call(supportToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: leadId, conversation_id: conv2.id });
    expect(linkBySupport.status).toBe(403); // needs lead.edit

    const oppBySupport = await call(supportToken, { workspace_id: ws.workspaceId, action: "create_opportunity", lead_id: leadId, title: "nope" });
    expect(oppBySupport.status).toBe(403); // needs opportunity.create
  });

  it("K17: read-only role (viewer) cannot create or link, but CAN sign an attachment it is allowed to view", async () => {
    const viewerToken = await tokenFor(viewer);
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230011", wa_id: "27831230011" });

    const createByViewer = await call(viewerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(createByViewer.status).toBe(403);

    const lead = await seedLead(ws.workspaceId, {});
    const linkByViewer = await call(viewerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: lead.id, conversation_id: conv.id });
    expect(linkByViewer.status).toBe(403);

    // sign_lead_attachment is a read gated on lead.view - the viewer has it.
    await seedMediaMessage(ws.workspaceId, conv.id, "viewer-open.pdf");
    const asOwnerCreate = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    const { data: att } = await admin.from("lead_attachments").select("id").eq("lead_id", asOwnerCreate.body.lead.id).single();
    const signByViewer = await call(viewerToken, { workspace_id: ws.workspaceId, action: "sign_lead_attachment", attachment_id: att!.id });
    expect(signByViewer.status).toBe(200);
    expect(typeof signByViewer.body.url).toBe("string");
  });

  it("K19/K20/K21: the conversion is CRM-only - it sends no WhatsApp message and creates no outbound inbox row / provider artefact", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230015", wa_id: "27831230015", ai_summary: "no side effects", intake_payload: { customer_name: "Quiet" } });
    await seedInboxMessage(ws.workspaceId, conv.id, { content: "inbound only" });
    const before = await admin.from("inbox_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id);

    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(r.status).toBe(200);
    await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_opportunity", lead_id: r.body.lead.id, title: "Quiet - deal" });

    const after = await admin.from("inbox_messages").select("id, direction", { count: "exact" }).eq("conversation_id", conv.id);
    expect(after.count).toBe(before.count); // no message appended
    expect((after.data || []).some((m) => m.direction === "outbound")).toBe(false); // nothing queued to send
    // leads-actions imports no provider client - there is no Meta/WhatsApp/OpenAI call path to assert against.
  });

  it("H: the conversion writes the expected audit rows into the shared workspace_activity_log (no forked table)", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { display_name: "Audit", phone_number: "+27831230012", wa_id: "27831230012", ai_summary: "audit check", intake_payload: { customer_name: "Audit", email: "audit@x.io" } });
    await seedMediaMessage(ws.workspaceId, conv.id, "audit.pdf");
    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    const leadId = r.body.lead.id;
    const { data: log } = await admin.from("workspace_activity_log").select("action").eq("workspace_id", ws.workspaceId).eq("target_id", leadId);
    const actions = (log || []).map((l) => l.action);
    expect(actions).toContain("lead_created");
    expect(actions).toContain("lead_linked_conversation");
    expect(actions).toContain("lead_intake_copied");
    expect(actions).toContain("lead_attachments_linked");
  });
});
