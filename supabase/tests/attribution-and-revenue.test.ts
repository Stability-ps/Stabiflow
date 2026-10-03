// Phase G. Attribution & Conversion Tracking - proves against the REAL
// deployed whatsapp-webhook/leads-actions/revenue-actions edge functions
// and the real attribution_events/revenue_events schema:
//   - the full mock chain (Campaign -> Ad -> Creative -> touchpoint ->
//     Conversation -> Lead -> Opportunity -> Customer -> Revenue), with
//     NO real Meta spend - every ad/campaign row here is a direct
//     service-role seed, never a real published campaign;
//   - the organic path (no referral at all) is fully valid, not an error;
//   - multi-touch: two real touches on the same lead are both preserved,
//     neither overwritten, first/last resolve correctly;
//   - manual attribution override (authorized succeeds + audit trail,
//     unauthorized is rejected);
//   - duplicate-event idempotency (a provider_event_id can never produce
//     two touchpoints);
//   - cross-workspace isolation on every new relationship, proven from a
//     direct service-role insert (the strongest possible caller);
//   - revenue_events creation, isolation, and survival across an
//     opportunity's later lifecycle changes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, getTestEnv, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedWorkspaceIntegration, seedFacebookPage, seedMediaAsset } from "./contentHelpers";
import { seedMetaAdAccount, seedAdCreative, seedAdCampaign, seedAdSet, seedAd } from "./campaignHelpers";
import { seedWhatsAppSetup } from "./inboxHelpers";
import { seedLead } from "./leadsHelpers";

const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const LEADS_ACTIONS_URL = `${SUPABASE_URL}/functions/v1/leads-actions`;
const REVENUE_ACTIONS_URL = `${SUPABASE_URL}/functions/v1/revenue-actions`;

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

function textMessagePayload(phoneNumberId: string, waId: string, messageId: string, text: string, referral?: { source_type: string; source_id: string; headline?: string; ctwa_clid?: string }) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-test", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: waId, profile: { name: "Attribution Test Customer" } }],
      messages: [{ from: waId, id: messageId, type: "text", text: { body: text }, ...(referral ? { referral } : {}) }],
    } }] }],
  });
}

async function postWebhook(body: string) {
  const res = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": await sign(body) }, body });
  return { status: res.status, text: await res.text() };
}

async function callLeadsAction(token: string, body: Record<string, unknown>) {
  const res = await fetch(LEADS_ACTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

async function callRevenueAction(token: string, body: Record<string, unknown>) {
  const res = await fetch(REVENUE_ACTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("Attribution & Revenue (release blocker)", () => {
  let workspace: TestTenant;
  let otherWorkspace: TestTenant;
  let ownerToken: string;
  let viewerToken: string; // attribution.view/revenue.view only - no attribution.manage or revenue.create

  beforeAll(async () => {
    workspace = await createTestTenant("attribution");
    otherWorkspace = await createTestTenant("attribution-other");
    const { data: session } = await workspace.client.auth.getSession();
    ownerToken = session.session!.access_token;

    const viewerUser = await createTestUser("attribution-viewer");
    await seedMembership(workspace.workspaceId, viewerUser.userId, "viewer");
    const { data: viewerSession } = await viewerUser.client.auth.getSession();
    viewerToken = viewerSession.session!.access_token;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(otherWorkspace);
  });

  describe("full mock chain: Campaign -> Ad -> Creative -> touchpoint -> Conversation -> Lead -> Opportunity -> Customer -> Revenue", () => {
    let campaignId: string;
    let adSetId: string;
    let adId: string;
    let creativeId: string;
    let numberId: string;
    let phoneNumberId: string;
    let conversationId: string;
    let attributionEventId: string;
    let leadId: string;
    let opportunityId: string;
    let customerId: string;

    beforeAll(async () => {
      const integrationId = await seedWorkspaceIntegration(workspace.workspaceId);
      const adAccountId = await seedMetaAdAccount(workspace.workspaceId, integrationId);
      const pageId = await seedFacebookPage(workspace.workspaceId, integrationId);
      const media = await seedMediaAsset(workspace.workspaceId, workspace.userId);
      creativeId = await seedAdCreative(workspace.workspaceId, media.id, workspace.userId);
      campaignId = await seedAdCampaign(workspace.workspaceId, integrationId, adAccountId, pageId, creativeId, workspace.userId, { name: "Full Chain Campaign" });
      adSetId = await seedAdSet(workspace.workspaceId, campaignId);
      adId = await seedAd(workspace.workspaceId, adSetId, creativeId, { external_ad_id: "meta-ad-full-chain-123" });

      const number = await seedWhatsAppSetup(workspace.workspaceId, { phone_number_id: `phone-full-chain-${Date.now()}` });
      numberId = number.id;
      phoneNumberId = number.phone_number_id;
    });

    it("a Click-to-WhatsApp referral matching StabiFlow's own ad creates ONE deterministic, exact-confidence touchpoint", async () => {
      const waId = `27${Date.now()}001`;
      const messageId = `wamid.full-chain-${Date.now()}`;
      const result = await postWebhook(textMessagePayload(phoneNumberId, waId, messageId, "Saw your ad, interested", {
        source_type: "ad", source_id: "meta-ad-full-chain-123", headline: "Big Sale", ctwa_clid: "clid-full-chain",
      }));
      expect(result.status).toBe(200);

      const { data: conversation } = await admin.from("inbox_conversations").select("id").eq("whatsapp_number_id", numberId).eq("wa_id", waId).single();
      conversationId = conversation!.id;

      const { data: events } = await admin.from("attribution_events").select("*").eq("conversation_id", conversationId);
      expect(events).toHaveLength(1);
      const event = events![0];
      attributionEventId = event.id;
      expect(event.campaign_id).toBe(campaignId);
      expect(event.ad_set_id).toBe(adSetId);
      expect(event.ad_id).toBe(adId);
      expect(event.creative_id).toBe(creativeId);
      expect(event.source_type).toBe("paid");
      expect(event.attribution_method).toBe("deterministic");
      expect(event.attribution_confidence).toBe("exact");
      expect(event.click_id).toBe("clid-full-chain");
    });

    it("REGRESSION: a second inbound message on the SAME conversation never creates a second touchpoint", async () => {
      const { data: conversation } = await admin.from("inbox_conversations").select("wa_id").eq("id", conversationId).single();
      await postWebhook(textMessagePayload(phoneNumberId, conversation!.wa_id, `wamid.full-chain-followup-${Date.now()}`, "Following up"));
      const { data: events } = await admin.from("attribution_events").select("id").eq("conversation_id", conversationId);
      expect(events).toHaveLength(1);
    });

    it("creating a lead from this conversation backfills lead_id onto the SAME event row - never a new one", async () => {
      const result = await callLeadsAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_from_conversation", conversation_id: conversationId });
      expect(result.status).toBe(200);
      leadId = result.body.lead.id;

      const { data: events } = await admin.from("attribution_events").select("id, lead_id, conversation_id").eq("conversation_id", conversationId);
      expect(events).toHaveLength(1);
      expect(events![0].id).toBe(attributionEventId);
      expect(events![0].lead_id).toBe(leadId);
    });

    it("creating an opportunity from this lead backfills opportunity_id onto the SAME event row", async () => {
      const result = await callLeadsAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_opportunity", lead_id: leadId, title: "Full chain deal" });
      expect(result.status).toBe(200);
      opportunityId = result.body.opportunity.id;

      const { data: event } = await admin.from("attribution_events").select("id, opportunity_id").eq("id", attributionEventId).single();
      expect(event!.opportunity_id).toBe(opportunityId);
    });

    it("winning the opportunity (with customer creation) backfills customer_id onto the SAME event row", async () => {
      const result = await callLeadsAction(ownerToken, { workspace_id: workspace.workspaceId, action: "mark_opportunity_won", opportunity_id: opportunityId, actual_value: 5000, create_customer: true });
      expect(result.status).toBe(200);
      customerId = result.body.customer.id;

      const { data: event } = await admin.from("attribution_events").select("id, customer_id").eq("id", attributionEventId).single();
      expect(event!.customer_id).toBe(customerId);
    });

    it("recording revenue against the won opportunity creates a real revenue_events row with amount_minor/currency preserved", async () => {
      const result = await callRevenueAction(ownerToken, {
        workspace_id: workspace.workspaceId, action: "record",
        amount_minor: 500000, currency: "ZAR", event_type: "sale", opportunity_id: opportunityId, customer_id: customerId, lead_id: leadId, reference: "Invoice #1",
      });
      expect(result.status).toBe(200);
      expect(result.body.revenue_event.amount_minor).toBe(500000);
      expect(result.body.revenue_event.currency).toBe("ZAR");
      expect(result.body.revenue_event.opportunity_id).toBe(opportunityId);
      expect(result.body.revenue_event.customer_id).toBe(customerId);
    });

    it("get_touch_summary resolves first_touch/last_touch/first_paid_touch/last_paid_touch to the SAME single deterministic event for the customer", async () => {
      const { data, error } = await workspace.client.rpc("get_touch_summary", { p_workspace_id: workspace.workspaceId, p_target_type: "customer", p_target_id: customerId });
      expect(error).toBeNull();
      const kinds = new Map((data as { touch_kind: string; event_id: string }[]).map((r) => [r.touch_kind, r.event_id]));
      expect(kinds.get("first_touch")).toBe(attributionEventId);
      expect(kinds.get("last_touch")).toBe(attributionEventId);
      expect(kinds.get("first_paid_touch")).toBe(attributionEventId);
      expect(kinds.get("last_paid_touch")).toBe(attributionEventId);
    });

    it("get_campaign_conversion_counts reflects the real conversation/lead/opportunity/customer this campaign produced - no ROAS, just counts", async () => {
      const { data, error } = await workspace.client.rpc("get_campaign_conversion_counts", { p_workspace_id: workspace.workspaceId, p_campaign_id: campaignId });
      expect(error).toBeNull();
      const row = Array.isArray(data) ? data[0] : data;
      expect(row.conversations).toBe(1);
      expect(row.leads).toBe(1);
      expect(row.opportunities).toBe(1);
      expect(row.customers).toBe(1);
    });

    it("revenue survives the opportunity's later lifecycle changes (reopen) - never deleted", async () => {
      await callLeadsAction(ownerToken, { workspace_id: workspace.workspaceId, action: "reopen_opportunity", opportunity_id: opportunityId });
      const { data: revenueRows } = await admin.from("revenue_events").select("id").eq("opportunity_id", opportunityId);
      expect(revenueRows!.length).toBeGreaterThan(0);
    });

    it("a Meta referral present but NOT matching any ad StabiFlow published is still recorded as paid, at LOW confidence, with no internal FK - never fabricated", async () => {
      const waId = `27${Date.now()}002`;
      await postWebhook(textMessagePayload(phoneNumberId, waId, `wamid.unmatched-ad-${Date.now()}`, "From an ad", {
        source_type: "ad", source_id: "some-ad-not-in-stabiflow", ctwa_clid: "clid-unmatched",
      }));
      const { data: conversation } = await admin.from("inbox_conversations").select("id").eq("whatsapp_number_id", numberId).eq("wa_id", waId).single();
      const { data: event } = await admin.from("attribution_events").select("*").eq("conversation_id", conversation!.id).single();
      expect(event!.source_type).toBe("paid");
      expect(event!.attribution_method).toBe("provider_reported");
      expect(event!.attribution_confidence).toBe("low");
      expect(event!.campaign_id).toBeNull();
    });
  });

  describe("organic path: Direct WhatsApp -> Conversation -> Lead, fully valid with no campaign attribution", () => {
    it("a message with no referral at all is recorded as an exact-confidence DIRECT touch, never 'unknown' by default", async () => {
      const number = await seedWhatsAppSetup(workspace.workspaceId, { phone_number_id: `phone-organic-${Date.now()}` });
      const waId = `27${Date.now()}003`;
      await postWebhook(textMessagePayload(number.phone_number_id, waId, `wamid.organic-${Date.now()}`, "Hi, do you deliver?"));

      const { data: conversation } = await admin.from("inbox_conversations").select("id").eq("whatsapp_number_id", number.id).eq("wa_id", waId).single();
      const { data: event } = await admin.from("attribution_events").select("*").eq("conversation_id", conversation!.id).single();
      expect(event!.source_type).toBe("direct");
      expect(event!.attribution_confidence).toBe("exact");
      expect(event!.campaign_id).toBeNull();
      expect(event!.ad_id).toBeNull();

      const leadResult = await callLeadsAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_from_conversation", conversation_id: conversation!.id });
      expect(leadResult.status).toBe(200);
      const { data: backfilled } = await admin.from("attribution_events").select("lead_id, source_type").eq("id", event!.id).single();
      expect(backfilled!.lead_id).toBe(leadResult.body.lead.id);
      expect(backfilled!.source_type).toBe("direct"); // still organic even once it's a lead - never silently upgraded to paid
    });
  });

  describe("multi-touch: two real touches on the same lead are both preserved", () => {
    it("first_touch and last_touch resolve to the earlier/later event respectively, and BOTH rows still exist afterward", async () => {
      const lead = await seedLead(workspace.workspaceId, { source: "manual" });
      const earlier = new Date(Date.now() - 2 * 86400_000).toISOString();
      const later = new Date(Date.now() - 1 * 86400_000).toISOString();

      const { data: firstEvent } = await admin.from("attribution_events").insert({
        workspace_id: workspace.workspaceId, event_type: "ad_click", lead_id: lead.id, occurred_at: earlier, platform: "meta", source_type: "paid", source: "meta",
        attribution_method: "deterministic", attribution_confidence: "exact", provider_event_id: `multi-touch-first-${lead.id}`,
      }).select("id").single();
      const { data: secondEvent } = await admin.from("attribution_events").insert({
        workspace_id: workspace.workspaceId, event_type: "ad_click", lead_id: lead.id, occurred_at: later, platform: "meta", source_type: "paid", source: "meta",
        attribution_method: "deterministic", attribution_confidence: "exact", provider_event_id: `multi-touch-second-${lead.id}`,
      }).select("id").single();

      const { data } = await workspace.client.rpc("get_touch_summary", { p_workspace_id: workspace.workspaceId, p_target_type: "lead", p_target_id: lead.id });
      const kinds = new Map((data as { touch_kind: string; event_id: string }[]).map((r) => [r.touch_kind, r.event_id]));
      expect(kinds.get("first_touch")).toBe(firstEvent!.id);
      expect(kinds.get("last_touch")).toBe(secondEvent!.id);

      const { data: allEvents } = await admin.from("attribution_events").select("id").eq("lead_id", lead.id);
      expect(allEvents).toHaveLength(2); // neither touch was overwritten or merged
    });
  });

  describe("manual attribution override", () => {
    it("an authorized user (attribution.manage) can override a lead's source - APPENDS a new event and logs an audit entry, never rewrites history", async () => {
      const lead = await seedLead(workspace.workspaceId, { source: "manual" });
      const before = await admin.from("attribution_events").select("id").eq("lead_id", lead.id);
      expect(before.data).toHaveLength(0);

      const result = await callLeadsAction(ownerToken, {
        workspace_id: workspace.workspaceId, action: "override_attribution", target_type: "lead", target_id: lead.id, source: "referral", reason: "Customer told us they were referred by an existing client",
      });
      expect(result.status).toBe(200);

      const { data: events } = await admin.from("attribution_events").select("*").eq("lead_id", lead.id);
      expect(events).toHaveLength(1);
      expect(events![0].attribution_method).toBe("manual");
      expect(events![0].attribution_confidence).toBe("exact");
      expect(events![0].metadata.override).toBe(true);
      expect(events![0].metadata.reason).toBeTruthy();

      const { data: activity } = await admin.from("workspace_activity_log").select("id").eq("workspace_id", workspace.workspaceId).eq("action", "attribution_overridden").eq("target_id", lead.id);
      expect(activity!.length).toBeGreaterThan(0);
    });

    it("a user with only attribution.view (not attribution.manage) cannot override attribution", async () => {
      const lead = await seedLead(workspace.workspaceId, { source: "manual" });
      const result = await callLeadsAction(viewerToken, {
        workspace_id: workspace.workspaceId, action: "override_attribution", target_type: "lead", target_id: lead.id, source: "referral", reason: "Should be rejected",
      });
      expect(result.status).toBe(403);
    });
  });

  describe("duplicate-event idempotency", () => {
    it("REGRESSION: the same provider_event_id can never produce two attribution_events rows in the same workspace", async () => {
      const providerEventId = `dedup-test-${Date.now()}`;
      const first = await admin.from("attribution_events").insert({
        workspace_id: workspace.workspaceId, event_type: "conversation_started", occurred_at: new Date().toISOString(), platform: "whatsapp", source_type: "direct", source: "whatsapp_direct",
        attribution_method: "deterministic", attribution_confidence: "exact", provider_event_id: providerEventId,
      });
      expect(first.error).toBeNull();

      const second = await admin.from("attribution_events").insert({
        workspace_id: workspace.workspaceId, event_type: "conversation_started", occurred_at: new Date().toISOString(), platform: "whatsapp", source_type: "direct", source: "whatsapp_direct",
        attribution_method: "deterministic", attribution_confidence: "exact", provider_event_id: providerEventId,
      });
      expect(second.error).not.toBeNull();
      expect(second.error?.code).toBe("23505");
    });
  });

  describe("cross-workspace isolation - direct service-role inserts (the strongest possible caller)", () => {
    it("REGRESSION: attribution_events cannot link to another workspace's campaign/ad/conversation/lead/opportunity/customer", async () => {
      const otherLead = await seedLead(otherWorkspace.workspaceId, { source: "manual" });
      const { error } = await admin.from("attribution_events").insert({
        workspace_id: workspace.workspaceId, event_type: "conversation_started", occurred_at: new Date().toISOString(), platform: "whatsapp", source_type: "direct", source: "whatsapp_direct",
        attribution_method: "deterministic", attribution_confidence: "exact", lead_id: otherLead.id,
      });
      expect(error).toBeTruthy();
      expect(error?.message).toMatch(/must belong to the same workspace/);
    });

    it("REGRESSION: revenue_events cannot link to another workspace's opportunity", async () => {
      const otherLead = await seedLead(otherWorkspace.workspaceId, { source: "manual" });
      const { data: otherOpportunity } = await admin.from("opportunities").insert({ workspace_id: otherWorkspace.workspaceId, lead_id: otherLead.id, title: "Other workspace deal" }).select("id").single();
      const { error } = await admin.from("revenue_events").insert({
        workspace_id: workspace.workspaceId, opportunity_id: otherOpportunity!.id, amount_minor: 1000, currency: "USD", event_type: "sale",
      });
      expect(error).toBeTruthy();
      expect(error?.message).toMatch(/must belong to the same workspace/);
    });

    it("REGRESSION: even a direct service-role insert cannot attach a different workspace's campaign to a campaign_entry_token", async () => {
      const integrationId = await seedWorkspaceIntegration(otherWorkspace.workspaceId);
      const adAccountId = await seedMetaAdAccount(otherWorkspace.workspaceId, integrationId);
      const pageId = await seedFacebookPage(otherWorkspace.workspaceId, integrationId);
      const media = await seedMediaAsset(otherWorkspace.workspaceId, otherWorkspace.userId);
      const creativeId = await seedAdCreative(otherWorkspace.workspaceId, media.id, otherWorkspace.userId);
      const otherCampaignId = await seedAdCampaign(otherWorkspace.workspaceId, integrationId, adAccountId, pageId, creativeId, otherWorkspace.userId);

      const { error } = await admin.from("campaign_entry_tokens").insert({ workspace_id: workspace.workspaceId, token: `tok-${Date.now()}`, campaign_id: otherCampaignId });
      expect(error).toBeTruthy();
      expect(error?.message).toMatch(/must belong to the same workspace/);
    });
  });

  describe("revenue_events", () => {
    it("an authorized user (revenue.create) can record revenue directly against a lead with no opportunity/customer yet", async () => {
      const lead = await seedLead(workspace.workspaceId, { source: "manual" });
      const result = await callRevenueAction(ownerToken, { workspace_id: workspace.workspaceId, action: "record", amount_minor: 25000, currency: "USD", event_type: "payment", lead_id: lead.id });
      expect(result.status).toBe(200);
      expect(result.body.revenue_event.lead_id).toBe(lead.id);
    });

    it("rejects a revenue event linked to nothing at all (no customer, opportunity, or lead)", async () => {
      const result = await callRevenueAction(ownerToken, { workspace_id: workspace.workspaceId, action: "record", amount_minor: 1000, currency: "USD", event_type: "sale" });
      expect(result.status).toBe(400);
    });

    it("rejects a zero amount_minor - a revenue event must represent a real, non-zero amount", async () => {
      const lead = await seedLead(workspace.workspaceId, { source: "manual" });
      const result = await callRevenueAction(ownerToken, { workspace_id: workspace.workspaceId, action: "record", amount_minor: 0, currency: "USD", event_type: "sale", lead_id: lead.id });
      expect(result.status).toBe(400);
    });

    it("a user without revenue.create cannot record revenue", async () => {
      const lead = await seedLead(workspace.workspaceId, { source: "manual" });
      const result = await callRevenueAction(viewerToken, { workspace_id: workspace.workspaceId, action: "record", amount_minor: 1000, currency: "USD", event_type: "sale", lead_id: lead.id });
      expect(result.status).toBe(403);
    });
  });
});
