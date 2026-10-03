// Phase F. Click-to-WhatsApp destination coverage: readiness validation,
// cross-workspace defense on ad_creatives.whatsapp_number_id (proven from
// the strongest possible caller - a direct service-role insert), and an
// end-to-end mock-mode publish proving the saga resolves the workspace's
// WhatsApp number and completes without error.
//
// What this does NOT prove: the exact Meta Graph API payload shape for a
// Click-to-WhatsApp ad creative (buildCreateAdCreativePayload's whatsapp
// branch in metaMarketingApi.ts) - that function is pure Deno-style
// TypeScript with no vitest-reachable test harness in this repository
// (same limitation as every other _shared/ad-providers module - see the
// Phase F completion report). The mock provider used below never calls
// that payload builder at all, so it cannot catch a malformed payload.
// Treat the payload shape as documented-but-unverified against a live
// Meta ad account, exactly like the error classifier's own disclosure.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedFacebookPage, seedMediaAsset, seedWorkspaceIntegration, uploadRealTestObject } from "./contentHelpers";
import { seedAdCampaign, seedAdCreative, seedMetaAdAccount } from "./campaignHelpers";

async function callReadiness(token: string, campaignId: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ad-campaigns-readiness`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ campaign_id: campaignId }),
  });
  return { status: res.status, body: await res.json() };
}

async function callPublish(token: string, campaignId: string, idempotencyKey: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ad-campaigns-publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ campaign_id: campaignId, idempotency_key: idempotencyKey }),
  });
  return { status: res.status, body: await res.json() };
}

describe("Click-to-WhatsApp campaign destination (release blocker)", () => {
  let workspaceA: TestTenant;
  let workspaceB: TestTenant;
  let integrationId: string;
  let adAccountId: string;
  let pageId: string;
  let mediaAssetId: string;
  let waNumberIdA: string;
  let waNumberIdB: string;
  let tokenA: string;

  beforeAll(async () => {
    workspaceA = await createTestTenant("wa-destination-a");
    workspaceB = await createTestTenant("wa-destination-b");

    integrationId = await seedWorkspaceIntegration(workspaceA.workspaceId);
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integrationId, p_secret: "mock-meta-token-not-a-real-credential" });
    adAccountId = await seedMetaAdAccount(workspaceA.workspaceId, integrationId);
    pageId = await seedFacebookPage(workspaceA.workspaceId, integrationId);
    const path = await uploadRealTestObject(workspaceA.client, workspaceA.workspaceId);
    const asset = await seedMediaAsset(workspaceA.workspaceId, workspaceA.userId, { storage_path: path });
    mediaAssetId = asset.id as string;

    const waIntegrationA = await admin.from("workspace_integrations").insert({ workspace_id: workspaceA.workspaceId, provider: "whatsapp", status: "connected" }).select("id").single();
    const { data: waNumberA } = await admin.from("workspace_whatsapp_numbers").insert({
      workspace_id: workspaceA.workspaceId, integration_id: waIntegrationA.data!.id, phone_number_id: `wa-a-${Date.now()}`, display_phone_number: "+27821234567", is_active: true,
    }).select("id").single();
    waNumberIdA = waNumberA!.id as string;

    const waIntegrationB = await admin.from("workspace_integrations").insert({ workspace_id: workspaceB.workspaceId, provider: "whatsapp", status: "connected" }).select("id").single();
    const { data: waNumberB } = await admin.from("workspace_whatsapp_numbers").insert({
      workspace_id: workspaceB.workspaceId, integration_id: waIntegrationB.data!.id, phone_number_id: `wa-b-${Date.now()}`, display_phone_number: "+27829998877", is_active: true,
    }).select("id").single();
    waNumberIdB = waNumberB!.id as string;

    const { data: session } = await workspaceA.client.auth.getSession();
    tokenA = session.session!.access_token;
  });

  afterAll(async () => {
    await cleanupTenant(workspaceA);
    await cleanupTenant(workspaceB);
  });

  it("REGRESSION: even a DIRECT service-role insert cannot attach a DIFFERENT workspace's WhatsApp number to an ad creative", async () => {
    const { error } = await admin.from("ad_creatives").insert({
      workspace_id: workspaceA.workspaceId,
      media_asset_id: mediaAssetId,
      primary_text: "cross-tenant attempt",
      cta: "WHATSAPP_MESSAGE",
      whatsapp_number_id: waNumberIdB, // belongs to workspace B
    });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/whatsapp_number_id must belong to the same workspace/);
  });

  it("readiness rejects a whatsapp destination with no WhatsApp number selected", async () => {
    const creativeId = await seedAdCreative(workspaceA.workspaceId, mediaAssetId, workspaceA.userId, { cta: "WHATSAPP_MESSAGE", destination_url: null, whatsapp_number_id: null });
    const campaignId = await seedAdCampaign(workspaceA.workspaceId, integrationId, adAccountId, pageId, creativeId, workspaceA.userId, {
      status: "ready", objective: "OUTCOME_TRAFFIC", destination_type: "whatsapp",
    });
    const result = await callReadiness(tokenA, campaignId);
    expect(result.status).toBe(200);
    expect(result.body.ready).toBe(false);
    expect(result.body.issues.some((i: { code: string }) => i.code === "missing_whatsapp_number")).toBe(true);
  });

  it("readiness rejects a whatsapp destination whose number has since been deactivated", async () => {
    const { data: inactiveNumber } = await admin.from("workspace_whatsapp_numbers").insert({
      workspace_id: workspaceA.workspaceId,
      integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", waNumberIdA).single()).data!.integration_id,
      phone_number_id: `wa-a-inactive-${Date.now()}`,
      display_phone_number: "+27820000000",
      is_active: false,
    }).select("id").single();

    const creativeId = await seedAdCreative(workspaceA.workspaceId, mediaAssetId, workspaceA.userId, { cta: "WHATSAPP_MESSAGE", destination_url: null, whatsapp_number_id: inactiveNumber!.id });
    const campaignId = await seedAdCampaign(workspaceA.workspaceId, integrationId, adAccountId, pageId, creativeId, workspaceA.userId, {
      status: "ready", objective: "OUTCOME_TRAFFIC", destination_type: "whatsapp",
    });
    const result = await callReadiness(tokenA, campaignId);
    expect(result.body.issues.some((i: { code: string }) => i.code === "whatsapp_number_inactive")).toBe(true);
  });

  it("a whatsapp-destination campaign publishes end to end in mock mode: the saga resolves the number and completes without error", async () => {
    const creativeId = await seedAdCreative(workspaceA.workspaceId, mediaAssetId, workspaceA.userId, { cta: "WHATSAPP_MESSAGE", destination_url: null, whatsapp_number_id: waNumberIdA });
    const campaignId = await seedAdCampaign(workspaceA.workspaceId, integrationId, adAccountId, pageId, creativeId, workspaceA.userId, {
      status: "ready", objective: "OUTCOME_TRAFFIC", destination_type: "whatsapp",
    });

    const result = await callPublish(tokenA, campaignId, crypto.randomUUID());
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.outcome).toBe("success");

    const { data: campaign } = await admin.from("ad_campaigns").select("status").eq("id", campaignId).single();
    expect(campaign?.status).toBe("active");
  }, 20000);
});
