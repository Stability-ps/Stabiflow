// Phase 2 - Conversation -> CRM completion, plus the senior-review
// remediation (H1 permission model, H2 idempotent recovery, M1 concurrent
// conversion, M2 re-link protection, M3 attachment signing revalidation,
// M4 deep intake merge, L1 batched linking).
//
// Everything runs against the REAL local leads-actions edge function with
// REAL authenticated users - the service role is used only to seed/inspect,
// never as the identity under test. leads-actions makes no provider calls
// (no Meta / WhatsApp send / OpenAI), so "no provider mutation" holds
// structurally.
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

// Seed an inbound media message AND put a real (tiny) object at its storage
// path so a signed URL can actually resolve. Path prefix is the workspace
// id, matching production and the M3 trigger's expectation.
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

describe("Conversation -> CRM completion + remediation (Phase 2)", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let ownerToken: string;
  let numberId: string;
  const roleUser: Record<string, { userId: string; client: SupabaseClient }> = {};
  const ROLES = ["admin", "manager", "sales", "support", "marketing", "viewer"] as const;

  beforeAll(async () => {
    ws = await createTestTenant("crm-completion");
    other = await createTestTenant("crm-completion-other");
    numberId = (await seedWhatsAppSetup(ws.workspaceId)).id;
    ownerToken = await tokenFor(ws);

    for (const role of ROLES) {
      const u = await createTestUser(`crm-completion-${role}`);
      await seedMembership(ws.workspaceId, u.userId, role);
      roleUser[role] = u;
    }
  });

  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
    for (const role of ROLES) await cleanupTenant({ userId: roleUser[role].userId });
  });

  // ---- baseline conversion behaviour -----------------------------------

  it("K1: create_from_conversation makes exactly ONE lead, copies the AI summary, preserves intake, maps safe typed fields, backfills attribution and sets conversation.lead_id", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      display_name: "Nomsa Dlamini",
      phone_number: "+27831230001",
      wa_id: "27831230001",
      ai_summary: "Wants a quote for 20 solar panels, installed in Durban, budget flexible.",
      intake_payload: { customer_name: "Nomsa Dlamini", email: "NOMSA@example.com", company_name: "Dlamini Energy", urgency: "high", budget: 40000 },
    });
    await admin.from("attribution_events").insert({
      workspace_id: ws.workspaceId, conversation_id: conv.id, event_type: "touchpoint", platform: "meta",
      occurred_at: new Date().toISOString(), source_type: "paid", attribution_method: "deterministic", attribution_confidence: "exact",
    });

    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(true);

    const { data: leads } = await admin.from("leads").select("id, summary, intake, contact_name, email, company_name, estimated_value").eq("created_from_conversation_id", conv.id);
    expect(leads).toHaveLength(1);
    const lead = leads![0];
    expect(lead.summary).toBe("Wants a quote for 20 solar panels, installed in Durban, budget flexible.");
    expect(lead.intake).toMatchObject({ customer_name: "Nomsa Dlamini", email: "NOMSA@example.com", urgency: "high", budget: 40000 });
    expect(lead.contact_name).toBe("Nomsa Dlamini");
    expect(lead.email).toBe("nomsa@example.com");
    expect(lead.company_name).toBe("Dlamini Energy");
    expect(lead.estimated_value).toBeNull();

    const { data: linkedConv } = await admin.from("inbox_conversations").select("lead_id").eq("id", conv.id).single();
    expect(linkedConv!.lead_id).toBe(lead.id);
    const { data: attr } = await admin.from("attribution_events").select("lead_id").eq("conversation_id", conv.id);
    expect(attr!.every((a) => a.lead_id === lead.id)).toBe(true);
  });

  it("K3: a conversation with NO ai_summary produces a lead with a null summary - never fabricated", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { display_name: "No Summary", phone_number: "+27831230002", wa_id: "27831230002", intake_payload: { interest_summary: "just browsing" } });
    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(r.status).toBe(200);
    const { data: lead } = await admin.from("leads").select("summary, intake").eq("id", r.body.lead.id).single();
    expect(lead!.summary).toBeNull();
    expect(lead!.intake).toMatchObject({ interest_summary: "just browsing" });
  });

  it("K7/K9/L1: inbound media is LINKED by reference; re-running does not duplicate; multiple items map 1:1", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { display_name: "Docs Sender", phone_number: "+27831230003", wa_id: "27831230003" });
    const m1 = await seedMediaMessage(ws.workspaceId, conv.id, "sars-letter.pdf");
    const m2 = await seedMediaMessage(ws.workspaceId, conv.id, "id.jpg", "image/jpeg");
    await seedInboxMessage(ws.workspaceId, conv.id, { content: "and here is the context" }); // text -> not an attachment

    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(r.status).toBe(200);
    expect(r.body.context.attachments_linked).toBe(2);
    expect(r.body.context.attachments_remaining).toBe(0);

    const { data: atts } = await admin.from("lead_attachments").select("storage_path, message_id, source").eq("lead_id", r.body.lead.id).order("received_at");
    expect(atts).toHaveLength(2);
    expect(atts!.map((a) => a.storage_path).sort()).toEqual([m1.path, m2.path].sort());
    expect(atts!.map((a) => a.message_id).sort()).toEqual([m1.id, m2.id].sort());
    expect(atts!.every((a) => a.source === "whatsapp_conversation")).toBe(true);

    const relink = await call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: r.body.lead.id, conversation_id: conv.id });
    expect(relink.status).toBe(200);
    expect(relink.body.context.attachments_linked).toBe(0);
    const { count } = await admin.from("lead_attachments").select("id", { count: "exact", head: true }).eq("lead_id", r.body.lead.id);
    expect(count).toBe(2);
  });

  it("K11: duplicate detection still surfaces an existing lead by phone (no force)", async () => {
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

  it("K12: linking to an EXISTING lead does NOT overwrite its summary; intake deep-merges with existing values winning; attachments are added", async () => {
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
    expect(after!.summary).toBe("Curated by the sales team.");
    expect(after!.intake).toMatchObject({ urgency: "low", owner_note: "hot lead", customer_name: "Sipho", email: "sipho@x.io" });
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

  it("K19/K20/K21: the conversion is CRM-only - it sends no WhatsApp message and creates no outbound inbox row", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230015", wa_id: "27831230015", ai_summary: "no side effects", intake_payload: { customer_name: "Quiet" } });
    await seedInboxMessage(ws.workspaceId, conv.id, { content: "inbound only" });
    const before = await admin.from("inbox_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id);
    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(r.status).toBe(200);
    await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_opportunity", lead_id: r.body.lead.id, title: "Quiet - deal" });
    const after = await admin.from("inbox_messages").select("id, direction", { count: "exact" }).eq("conversation_id", conv.id);
    expect(after.count).toBe(before.count);
    expect((after.data || []).some((m) => m.direction === "outbound")).toBe(false);
  });

  it("H: the conversion writes the expected audit rows into the shared workspace_activity_log", async () => {
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

  // ---- H1: dedicated lead.attachment.view permission -------------------

  it("H1: role matrix for lead.attachment.view on sign_lead_attachment (owner/admin/manager/sales/support = allowed, marketing/viewer = denied)", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230020", wa_id: "27831230020" });
    await seedMediaMessage(ws.workspaceId, conv.id, "matrix.pdf");
    const created = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    const { data: att } = await admin.from("lead_attachments").select("id").eq("lead_id", created.body.lead.id).single();

    for (const role of ["admin", "manager", "sales", "support"] as const) {
      const t = await tokenFor(roleUser[role]);
      const res = await call(t, { workspace_id: ws.workspaceId, action: "sign_lead_attachment", attachment_id: att!.id });
      expect(res.status, `${role} should be allowed`).toBe(200);
      expect(typeof res.body.url).toBe("string");
    }
    const ownerRes = await call(ownerToken, { workspace_id: ws.workspaceId, action: "sign_lead_attachment", attachment_id: att!.id });
    expect(ownerRes.status).toBe(200);

    for (const role of ["marketing", "viewer"] as const) {
      const t = await tokenFor(roleUser[role]);
      const res = await call(t, { workspace_id: ws.workspaceId, action: "sign_lead_attachment", attachment_id: att!.id });
      expect(res.status, `${role} should be denied`).toBe(403);
      expect(res.body.url).toBeUndefined();
    }
  });

  it("H1: a lead.view holder WITHOUT lead.attachment.view cannot even read the attachment metadata rows (RLS)", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230021", wa_id: "27831230021" });
    await seedMediaMessage(ws.workspaceId, conv.id, "rls.pdf");
    const created = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });

    const viewer = roleUser["viewer"];
    const { data: seen } = await viewer.client.from("lead_attachments").select("id").eq("lead_id", created.body.lead.id);
    expect(seen ?? []).toHaveLength(0);
    // sanity: the owner (has the permission) does see it
    const { data: ownerSees } = await ws.client.from("lead_attachments").select("id").eq("lead_id", created.body.lead.id);
    expect((ownerSees ?? []).length).toBe(1);
  });

  it("K18: sign_lead_attachment returns a usable signed URL; a bogus id fails safely with 404", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230004", wa_id: "27831230004" });
    await seedMediaMessage(ws.workspaceId, conv.id, "quote.pdf");
    const created = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    const { data: att } = await admin.from("lead_attachments").select("id").eq("lead_id", created.body.lead.id).single();

    const signed = await call(ownerToken, { workspace_id: ws.workspaceId, action: "sign_lead_attachment", attachment_id: att!.id });
    expect(signed.status).toBe(200);
    expect(signed.body.url).toContain("/storage/v1/object/sign/inbox-media/");
    const reachable = String(signed.body.url).replace(/^https?:\/\/[^/]+/, SUPABASE_URL);
    const head = await fetch(reachable, { method: "GET" });
    expect(head.ok).toBe(true);

    const missing = await call(ownerToken, { workspace_id: ws.workspaceId, action: "sign_lead_attachment", attachment_id: "00000000-0000-0000-0000-000000000000" });
    expect(missing.status).toBe(404);
  });

  // ---- M2: re-link protection ----------------------------------------

  it("M2: first link succeeds, same-lead link is idempotent, a DIFFERENT-lead link is rejected 409, attribution stays with the original lead", async () => {
    const leadA = await seedLead(ws.workspaceId, {});
    const leadB = await seedLead(ws.workspaceId, {});
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230030", wa_id: "27831230030", ai_summary: "belongs to A" });
    await admin.from("attribution_events").insert({
      workspace_id: ws.workspaceId, conversation_id: conv.id, event_type: "touchpoint", platform: "meta",
      occurred_at: new Date().toISOString(), source_type: "paid", attribution_method: "deterministic", attribution_confidence: "exact",
    });

    const first = await call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: leadA.id, conversation_id: conv.id });
    expect(first.status).toBe(200);

    const again = await call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: leadA.id, conversation_id: conv.id });
    expect(again.status).toBe(200);
    expect(again.body.already_linked).toBe(true);

    const moved = await call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: leadB.id, conversation_id: conv.id });
    expect(moved.status).toBe(409);
    expect(moved.body.error).toMatch(/already linked to another lead/i);

    const { data: convAfter } = await admin.from("inbox_conversations").select("lead_id").eq("id", conv.id).single();
    expect(convAfter!.lead_id).toBe(leadA.id);
    const { data: attr } = await admin.from("attribution_events").select("lead_id").eq("conversation_id", conv.id);
    expect(attr!.every((a) => a.lead_id === leadA.id)).toBe(true);
  });

  it("M2 (concurrent): two simultaneous link_conversation calls to two DIFFERENT leads - exactly one wins, the other gets 409", async () => {
    const leadA = await seedLead(ws.workspaceId, {});
    const leadB = await seedLead(ws.workspaceId, {});
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230031", wa_id: "27831230031" });
    await admin.from("attribution_events").insert({
      workspace_id: ws.workspaceId, conversation_id: conv.id, event_type: "touchpoint", platform: "meta",
      occurred_at: new Date().toISOString(), source_type: "paid", attribution_method: "deterministic", attribution_confidence: "exact",
    });

    const [rA, rB] = await Promise.all([
      call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: leadA.id, conversation_id: conv.id }),
      call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: leadB.id, conversation_id: conv.id }),
    ]);
    const statuses = [rA.status, rB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const { data: convAfter } = await admin.from("inbox_conversations").select("lead_id").eq("id", conv.id).single();
    const winner = convAfter!.lead_id;
    expect([leadA.id, leadB.id]).toContain(winner);
    const loser = winner === leadA.id ? leadB.id : leadA.id;
    const { data: attr } = await admin.from("attribution_events").select("lead_id").eq("conversation_id", conv.id);
    expect(attr!.every((a) => a.lead_id === winner)).toBe(true);
    expect(attr!.some((a) => a.lead_id === loser)).toBe(false);
  });

  // ---- M1: concurrent conversion -----------------------------------

  it("M1 (concurrent): two simultaneous create_from_conversation calls create exactly ONE lead, no orphan", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      display_name: "Race", phone_number: "+27831230040", wa_id: "27831230040",
      ai_summary: "raced", intake_payload: { customer_name: "Race" },
    });
    await seedMediaMessage(ws.workspaceId, conv.id, "race.pdf");
    await admin.from("attribution_events").insert({
      workspace_id: ws.workspaceId, conversation_id: conv.id, event_type: "touchpoint", platform: "meta",
      occurred_at: new Date().toISOString(), source_type: "paid", attribution_method: "deterministic", attribution_confidence: "exact",
    });

    const [r1, r2] = await Promise.all([
      call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id }),
      call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect([r1.body.created, r2.body.created].filter(Boolean)).toHaveLength(1); // exactly one creator

    const { data: leads } = await admin.from("leads").select("id").eq("created_from_conversation_id", conv.id);
    expect(leads).toHaveLength(1); // no orphan
    const leadId = leads![0].id;

    const { data: convAfter } = await admin.from("inbox_conversations").select("lead_id").eq("id", conv.id).single();
    expect(convAfter!.lead_id).toBe(leadId);

    const { data: atts } = await admin.from("lead_attachments").select("id").eq("lead_id", leadId);
    expect(atts).toHaveLength(1); // linked exactly once

    const { data: attr } = await admin.from("attribution_events").select("lead_id").eq("conversation_id", conv.id);
    expect(attr!.every((a) => a.lead_id === leadId)).toBe(true);
  });

  // ---- F1: create_from_conversation vs link_conversation race ------

  it("F1 (concurrent create-vs-link): the conversion never overwrites a link_conversation winner; ownership and attribution never split", async () => {
    const leadA = await seedLead(ws.workspaceId, { summary: "existing lead A" });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      display_name: "CvL", phone_number: "+27831230090", wa_id: "27831230090",
      ai_summary: "raced create vs link", intake_payload: { customer_name: "CvL" },
    });
    await seedMediaMessage(ws.workspaceId, conv.id, "cvl.pdf");
    await admin.from("attribution_events").insert({
      workspace_id: ws.workspaceId, conversation_id: conv.id, event_type: "touchpoint", platform: "meta",
      occurred_at: new Date().toISOString(), source_type: "paid", attribution_method: "deterministic", attribution_confidence: "exact",
    });

    // Genuinely concurrent: both requests are in flight before either awaits.
    const [rCreate, rLink] = await Promise.all([
      call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id }),
      call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: leadA.id, conversation_id: conv.id }),
    ]);

    // Exactly one lead owns the conversation, and it is a consistent value.
    const { data: convAfter } = await admin.from("inbox_conversations").select("lead_id").eq("id", conv.id).single();
    const winner = convAfter!.lead_id as string;
    expect(winner).toBeTruthy();

    // The unique created_from_conversation_id index still holds: <= 1 lead
    // was ever created from this conversation.
    const { data: createdLeads } = await admin.from("leads").select("id").eq("created_from_conversation_id", conv.id);
    expect((createdLeads ?? []).length).toBeLessThanOrEqual(1);
    const createLeadId = (createdLeads?.[0]?.id as string | undefined) ?? null;

    expect([leadA.id, createLeadId].filter(Boolean)).toContain(winner);
    const loser = winner === leadA.id ? createLeadId : leadA.id;

    // Status shape: one linkage success + a clean 409 on the loser, OR - if
    // link fully committed before the conversion even read the conversation,
    // so the conversion just adopts lead A - an idempotent success on both.
    if (winner === leadA.id && createLeadId) {
      // link won; create_from_conversation inserted its own lead then lost.
      expect(rLink.status).toBe(200);
      expect(rCreate.status).toBe(409);
      expect(String(rCreate.body.error)).toMatch(/linked to another lead while the conversion was in progress/i);
      expect(rCreate.body.created).toBeUndefined();
    } else if (winner === createLeadId) {
      // create_from_conversation won.
      expect(rCreate.status).toBe(200);
      expect(rCreate.body.created).toBe(true);
      expect(rLink.status).toBe(409);
      expect(String(rLink.body.error)).toMatch(/already linked to another lead/i);
    } else {
      // both operations resolved to the same lead (A) -> idempotent success.
      expect(winner).toBe(leadA.id);
      expect(createLeadId).toBeNull();
      expect([rCreate.status, rLink.status]).toEqual([200, 200]);
    }

    // Attribution lives ONLY on the winner - never split, never on the loser.
    const { data: attr } = await admin.from("attribution_events").select("lead_id").eq("conversation_id", conv.id);
    expect(attr!.length).toBeGreaterThan(0);
    expect(attr!.every((a) => a.lead_id === winner)).toBe(true);
    if (loser) expect(attr!.some((a) => a.lead_id === loser)).toBe(false);

    // The losing lead got NO post-conflict work: not linked, no attachments,
    // no lead_linked_conversation / lead_attachments_linked audit. (A harmless
    // orphan lead from the create side is allowed to exist; we do not clean it
    // up and we do not fail on it.)
    if (loser) {
      const { data: convsOnLoser } = await admin.from("inbox_conversations").select("id").eq("lead_id", loser);
      expect(convsOnLoser ?? []).toHaveLength(0);
      const { count: loserAtts } = await admin.from("lead_attachments").select("id", { count: "exact", head: true }).eq("lead_id", loser);
      expect(loserAtts).toBe(0);
      const { data: loserLog } = await admin.from("workspace_activity_log").select("action").eq("workspace_id", ws.workspaceId).eq("target_id", loser);
      const loserActions = (loserLog ?? []).map((l) => l.action);
      expect(loserActions).not.toContain("lead_linked_conversation");
      expect(loserActions).not.toContain("lead_attachments_linked");
    }

    // The winner is fully consistent: it owns the conversation AND the attribution.
    expect(attr!.every((a) => a.lead_id === winner)).toBe(true);
    const { data: convFinal } = await admin.from("inbox_conversations").select("lead_id").eq("id", conv.id).single();
    expect(convFinal!.lead_id).toBe(winner);
  });

  // ---- H2: idempotent partial-failure recovery ---------------------

  it("H2: an attachment-link failure AFTER lead creation returns a curated error, does not claim created:true; a retry repairs the missing attachment without a second lead", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      display_name: "Heal", phone_number: "+27831230050", wa_id: "27831230050",
      ai_summary: "needs healing", intake_payload: { customer_name: "Heal" },
    });
    await admin.from("attribution_events").insert({
      workspace_id: ws.workspaceId, conversation_id: conv.id, event_type: "touchpoint", platform: "meta",
      occurred_at: new Date().toISOString(), source_type: "paid", attribution_method: "deterministic", attribution_confidence: "exact",
    });
    // A media message whose stored path does NOT resolve to this workspace -
    // the M3 trigger rejects the lead_attachments insert (23514), so media
    // linking fails after the lead + link + attribution are already done.
    const badMsgId = await seedInboxMessage(ws.workspaceId, conv.id, {
      message_type: "document", content: "[bad]",
      media_storage_path: "not-a-workspace/broken/file.pdf", media_mime_type: "application/pdf", media_filename: "broken.pdf", media_size_bytes: 8,
    });

    const first = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(first.status).toBe(500);
    expect(first.body.created).toBeUndefined(); // never claims created:true on partial failure
    expect(String(first.body.error)).toMatch(/document/i);

    // The lead + link + attribution DID land (partial progress is real).
    const { data: leadsMid } = await admin.from("leads").select("id, summary").eq("created_from_conversation_id", conv.id);
    expect(leadsMid).toHaveLength(1);
    const leadId = leadsMid![0].id;
    expect(leadsMid![0].summary).toBe("needs healing");
    const { data: convMid } = await admin.from("inbox_conversations").select("lead_id").eq("id", conv.id).single();
    expect(convMid!.lead_id).toBe(leadId);
    const { data: attrMid } = await admin.from("attribution_events").select("lead_id").eq("conversation_id", conv.id);
    expect(attrMid!.every((a) => a.lead_id === leadId)).toBe(true);
    const { count: attsMid } = await admin.from("lead_attachments").select("id", { count: "exact", head: true }).eq("lead_id", leadId);
    expect(attsMid).toBe(0); // the attachment is missing

    // Fix the underlying media, then retry the SAME action.
    const goodPath = `${ws.workspaceId}/${conv.id}/${Date.now()}-healed.pdf`;
    await admin.storage.from("inbox-media").upload(goodPath, new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
    await admin.from("inbox_messages").update({ media_storage_path: goodPath }).eq("id", badMsgId);

    const retry = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(retry.status).toBe(200);
    expect(retry.body.created).toBe(false); // NOT a second creation
    expect(retry.body.context.attachments_linked).toBe(1);

    const { data: leadsAfter } = await admin.from("leads").select("id").eq("created_from_conversation_id", conv.id);
    expect(leadsAfter).toHaveLength(1); // still exactly one lead
    expect(leadsAfter![0].id).toBe(leadId);
    const { data: attsAfter } = await admin.from("lead_attachments").select("storage_path").eq("lead_id", leadId);
    expect(attsAfter).toHaveLength(1);
    expect(attsAfter![0].storage_path).toBe(goodPath);
  });

  // ---- M3: attachment signing revalidation + DB integrity ----------

  it("M3: the DB rejects a lead_attachments row whose storage_path resolves to a FOREIGN workspace (even via service role)", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230060", wa_id: "27831230060" });
    const lead = await seedLead(ws.workspaceId, {});
    const { error } = await admin.from("lead_attachments").insert({
      workspace_id: ws.workspaceId, lead_id: lead.id, conversation_id: conv.id,
      storage_bucket: "inbox-media", storage_path: `${other.workspaceId}/x/foreign.pdf`, source: "whatsapp_conversation",
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/workspace/i);
  });

  it("M3: the DB rejects a non-'inbox-media' storage_bucket", async () => {
    const lead = await seedLead(ws.workspaceId, {});
    const { error } = await admin.from("lead_attachments").insert({
      workspace_id: ws.workspaceId, lead_id: lead.id,
      storage_bucket: "content-media", storage_path: `${ws.workspaceId}/x/y.pdf`, source: "whatsapp_conversation",
    });
    expect(error).toBeTruthy();
  });

  it("M3: the DB rejects a storage_path that does not match its cited source message's media", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230061", wa_id: "27831230061" });
    const lead = await seedLead(ws.workspaceId, {});
    const m = await seedMediaMessage(ws.workspaceId, conv.id, "real.pdf");
    const otherValidPath = `${ws.workspaceId}/${conv.id}/${Date.now()}-mismatch.pdf`;
    const { error } = await admin.from("lead_attachments").insert({
      workspace_id: ws.workspaceId, lead_id: lead.id, conversation_id: conv.id, message_id: m.id,
      storage_bucket: "inbox-media", storage_path: otherValidPath, source: "whatsapp_conversation",
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/source message/i);
  });

  it("M3 (trigger): cross-workspace message_id and conversation_id are rejected", async () => {
    const otherNumberId = (await seedWhatsAppSetup(other.workspaceId)).id;
    const otherConv = await seedInboxConversation(other.workspaceId, otherNumberId, { phone_number: "+27899990010", wa_id: "27899990010" });
    const otherMedia = await seedMediaMessage(other.workspaceId, otherConv.id, "theirs.pdf");
    const lead = await seedLead(ws.workspaceId, {});

    const crossMsg = await admin.from("lead_attachments").insert({
      workspace_id: ws.workspaceId, lead_id: lead.id, message_id: otherMedia.id,
      storage_bucket: "inbox-media", storage_path: `${ws.workspaceId}/x/y.pdf`, source: "whatsapp_conversation",
    });
    expect(crossMsg.error).toBeTruthy();

    const crossConv = await admin.from("lead_attachments").insert({
      workspace_id: ws.workspaceId, lead_id: lead.id, conversation_id: otherConv.id,
      storage_bucket: "inbox-media", storage_path: `${ws.workspaceId}/x/y.pdf`, source: "whatsapp_conversation",
    });
    expect(crossConv.error).toBeTruthy();
  });

  it("M3: signing still works after the source message is deleted (message_id -> NULL, path still valid)", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230062", wa_id: "27831230062" });
    const m = await seedMediaMessage(ws.workspaceId, conv.id, "willdelete.pdf");
    const created = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    const { data: att } = await admin.from("lead_attachments").select("id").eq("lead_id", created.body.lead.id).single();

    await admin.from("inbox_messages").delete().eq("id", m.id);
    const { data: attAfter } = await admin.from("lead_attachments").select("message_id").eq("id", att!.id).single();
    expect(attAfter!.message_id).toBeNull();

    const signed = await call(ownerToken, { workspace_id: ws.workspaceId, action: "sign_lead_attachment", attachment_id: att!.id });
    expect(signed.status).toBe(200);
    const reachable = String(signed.body.url).replace(/^https?:\/\/[^/]+/, SUPABASE_URL);
    expect((await fetch(reachable)).ok).toBe(true);
  });

  // ---- tenant isolation ------------------------------------------

  it("K10/K22/#8: workspace A's attachment is invisible to a workspace B user, and cannot be signed via a cross-workspace id", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230005", wa_id: "27831230005" });
    await seedMediaMessage(ws.workspaceId, conv.id, "private.pdf");
    const created = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    const { data: att } = await admin.from("lead_attachments").select("id").eq("lead_id", created.body.lead.id).single();

    // Positive RLS lookup: query A's row id explicitly as B's owner -> 0 rows.
    const { data: seenByB } = await other.client.from("lead_attachments").select("id").eq("id", att!.id);
    expect(seenByB ?? []).toHaveLength(0);

    const otherToken = await tokenFor(other);
    const crossSign = await call(otherToken, { workspace_id: other.workspaceId, action: "sign_lead_attachment", attachment_id: att!.id });
    expect(crossSign.status).toBe(404);
  });

  it("K22: cannot link a workspace-B conversation to a workspace-A lead", async () => {
    const leadInWs = await seedLead(ws.workspaceId, {});
    const otherNumberId = (await seedWhatsAppSetup(other.workspaceId)).id;
    const convInOther = await seedInboxConversation(other.workspaceId, otherNumberId, { phone_number: "+27899990001", wa_id: "27899990001" });
    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: leadInWs.id, conversation_id: convInOther.id });
    expect(r.status).toBe(404);
  });

  // ---- permission gating --------------------------------------

  it("K16: support (lead.view + lead.create, NO lead.edit / opportunity.create) may create but not link or open an opportunity", async () => {
    const supportToken = await tokenFor(roleUser["support"]);
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { display_name: "Support Made", phone_number: "+27831230013", wa_id: "27831230013", ai_summary: "support can create this" });
    const created = await call(supportToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    expect(created.status).toBe(200);
    expect(created.body.created).toBe(true);
    const leadId = created.body.lead.id;

    const conv2 = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230014", wa_id: "27831230014" });
    const linkBySupport = await call(supportToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: leadId, conversation_id: conv2.id });
    expect(linkBySupport.status).toBe(403);

    const oppBySupport = await call(supportToken, { workspace_id: ws.workspaceId, action: "create_opportunity", lead_id: leadId, title: "nope" });
    expect(oppBySupport.status).toBe(403);
  });

  it("#10/#11: apply_context and overwrite_summary are unreachable without lead.edit", async () => {
    const lead = await seedLead(ws.workspaceId, { summary: "keep me" });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230070", wa_id: "27831230070", ai_summary: "should not apply" });

    for (const role of ["support", "viewer"] as const) {
      const t = await tokenFor(roleUser[role]);
      const a = await call(t, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: lead.id, conversation_id: conv.id, apply_context: true });
      expect(a.status, `${role} apply_context`).toBe(403);
      const b = await call(t, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: lead.id, conversation_id: conv.id, overwrite_summary: true });
      expect(b.status, `${role} overwrite_summary`).toBe(403);
    }
    // nothing changed
    const { data: after } = await admin.from("leads").select("summary").eq("id", lead.id).single();
    expect(after!.summary).toBe("keep me");
    const { data: convAfter } = await admin.from("inbox_conversations").select("lead_id").eq("id", conv.id).single();
    expect(convAfter!.lead_id).toBeNull();
  });

  it("K17: viewer (lead.view only) cannot create, link, or sign an attachment", async () => {
    const viewerToken = await tokenFor(roleUser["viewer"]);
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { phone_number: "+27831230011", wa_id: "27831230011" });
    expect((await call(viewerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id })).status).toBe(403);
    const lead = await seedLead(ws.workspaceId, {});
    expect((await call(viewerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: lead.id, conversation_id: conv.id })).status).toBe(403);

    await seedMediaMessage(ws.workspaceId, conv.id, "viewer-open.pdf");
    const asOwner = await call(ownerToken, { workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id });
    const { data: att } = await admin.from("lead_attachments").select("id").eq("lead_id", asOwner.body.lead.id).single();
    const signByViewer = await call(viewerToken, { workspace_id: ws.workspaceId, action: "sign_lead_attachment", attachment_id: att!.id });
    expect(signByViewer.status).toBe(403);
  });

  // ---- M4: deep intake merge (integration) -------------------------

  it("M4: linking deep-merges nested intake - existing lead sub-keys win, conversation fills what is missing", async () => {
    const lead = await seedLead(ws.workspaceId, { intake: { company: { name: "Acme", size: 12 }, urgency: "low" } });
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      phone_number: "+27831230080", wa_id: "27831230080",
      intake_payload: { company: { name: "SHOULD NOT WIN", industry: "Mining" }, urgency: "high", region: "KZN" },
    });
    const r = await call(ownerToken, { workspace_id: ws.workspaceId, action: "link_conversation", lead_id: lead.id, conversation_id: conv.id });
    expect(r.status).toBe(200);
    const { data: after } = await admin.from("leads").select("intake").eq("id", lead.id).single();
    expect(after!.intake).toEqual({
      company: { name: "Acme", size: 12, industry: "Mining" },
      urgency: "low",
      region: "KZN",
    });
  });
});
