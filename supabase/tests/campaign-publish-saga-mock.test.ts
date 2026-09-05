// Phase F. Proves the publish SAGA itself (not just the idempotency claim
// around it - see campaign-publish-idempotency.test.ts, which deliberately
// never reaches a live provider call) against the REAL deployed
// ad-campaigns-publish edge function, using the mock Meta Ads provider
// (metaMarketingApiMock.ts) that INTEGRATIONS_META_MOCK_MODE switches in.
// No real Meta API call is made and no real advertising spend is possible
// - the mock provider never performs network I/O.
//
// This is the ONLY safe way to prove: a full 4-step publish actually
// succeeds end to end, a mid-saga failure leaves provider_state accurately
// reflecting partial progress, and a retry resumes from the right step
// instead of re-creating (and double-spending against) objects that
// already exist - none of which the idempotency test above can exercise,
// since it fails before any provider call is ever attempted.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedFacebookPage, seedMediaAsset, seedWorkspaceIntegration, uploadRealTestObject } from "./contentHelpers";
import { seedAdCampaign, seedAdCreative, seedMetaAdAccount } from "./campaignHelpers";

async function callPublish(token: string, campaignId: string, idempotencyKey: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ad-campaigns-publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ campaign_id: campaignId, idempotency_key: idempotencyKey }),
  });
  return { status: res.status, body: await res.json() };
}

describe("Campaign publish saga - mock provider (release blocker)", () => {
  let workspace: TestTenant;
  let integrationId: string;
  let adAccountId: string;
  let pageId: string;
  let mediaAssetId: string;
  let token: string;

  beforeAll(async () => {
    workspace = await createTestTenant("publish-saga-mock");
    integrationId = await seedWorkspaceIntegration(workspace.workspaceId);
    // The mock provider never inspects this value - any string proves
    // token RESOLUTION succeeds (the thing the idempotency test's seed
    // deliberately leaves unset), letting the saga actually reach the
    // mock provider calls.
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integrationId, p_secret: "mock-meta-token-not-a-real-credential" });
    adAccountId = await seedMetaAdAccount(workspace.workspaceId, integrationId);
    pageId = await seedFacebookPage(workspace.workspaceId, integrationId);
    const path = await uploadRealTestObject(workspace.client, workspace.workspaceId);
    const asset = await seedMediaAsset(workspace.workspaceId, workspace.userId, { storage_path: path });
    mediaAssetId = asset.id as string;
    const { data: session } = await workspace.client.auth.getSession();
    token = session.session!.access_token;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
  });

  it("a full publish succeeds end to end: all 4 provider objects created in order, ad_sets/ads rows inserted, campaign becomes active", async () => {
    const creativeId = await seedAdCreative(workspace.workspaceId, mediaAssetId, workspace.userId);
    const campaignId = await seedAdCampaign(workspace.workspaceId, integrationId, adAccountId, pageId, creativeId, workspace.userId, { status: "ready" });

    const result = await callPublish(token, campaignId, crypto.randomUUID());
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.outcome).toBe("success");
    expect(result.body.operation.steps.map((s: { step: string }) => s.step)).toEqual(["campaign", "ad_set", "creative", "ad"]);
    expect(result.body.operation.steps.every((s: { status: string }) => s.status === "success")).toBe(true);

    const { data: campaign } = await admin.from("ad_campaigns").select("status, external_campaign_id, provider_configured_status, provider_state").eq("id", campaignId).single();
    expect(campaign?.status).toBe("active");
    expect(campaign?.provider_configured_status).toBe("ACTIVE");
    expect(campaign?.external_campaign_id).toMatch(/^mock_campaign_/);
    expect(campaign?.provider_state.ad?.external_id).toMatch(/^mock_ad_/);

    const { data: adSets } = await admin.from("ad_sets").select("id, status, external_adset_id").eq("campaign_id", campaignId);
    expect(adSets).toHaveLength(1);
    expect(adSets![0].status).toBe("active");
    expect(adSets![0].external_adset_id).toMatch(/^mock_adset_/);

    const { data: ads } = await admin.from("ads").select("status, external_ad_id").eq("ad_set_id", adSets![0].id);
    expect(ads).toHaveLength(1);
    expect(ads![0].status).toBe("active");
  }, 20000);

  it("REGRESSION: a mid-saga failure leaves provider_state accurately reflecting partial progress, and a retry resumes from exactly the right step instead of re-creating earlier objects", async () => {
    const creativeId = await seedAdCreative(workspace.workspaceId, mediaAssetId, workspace.userId);
    const campaignId = await seedAdCampaign(workspace.workspaceId, integrationId, adAccountId, pageId, creativeId, workspace.userId, {
      status: "ready",
      // Test-only hook (adPublishExecution.ts), only ever honored when
      // INTEGRATIONS_META_MOCK_MODE is true - forces the "ad" step to
      // fail after campaign/ad_set/creative have already succeeded.
      audience: { age_min: 18, age_max: 65, genders: "all", geo_countries: ["ZA"], _mock_fail_step: "ad" },
    });

    const firstAttempt = await callPublish(token, campaignId, crypto.randomUUID());
    expect(firstAttempt.status).toBe(200);
    expect(firstAttempt.body.ok).toBe(false);
    expect(firstAttempt.body.outcome).toBe("partial");
    expect(firstAttempt.body.operation.steps.map((s: { step: string }) => s.step)).toEqual(["campaign", "ad_set", "creative", "ad"]);
    expect(firstAttempt.body.operation.steps[3].status).toBe("failed");

    const { data: afterFailure } = await admin.from("ad_campaigns").select("status, provider_state").eq("id", campaignId).single();
    expect(afterFailure?.status).toBe("failed");
    expect(afterFailure?.provider_state.campaign).toBeTruthy();
    expect(afterFailure?.provider_state.ad_set).toBeTruthy();
    expect(afterFailure?.provider_state.creative).toBeTruthy();
    expect(afterFailure?.provider_state.ad).toBeUndefined(); // the one step that actually failed

    // Clear the forced-failure hook so the retry can genuinely succeed -
    // "the campaign owner fixed whatever was wrong and tries again", not
    // an infinite forced failure.
    await admin.from("ad_campaigns").update({ status: "failed", audience: { age_min: 18, age_max: 65, genders: "all", geo_countries: ["ZA"] } }).eq("id", campaignId);

    const retry = await callPublish(token, campaignId, crypto.randomUUID());
    expect(retry.status).toBe(200);
    expect(retry.body.ok).toBe(true);
    // Only the "ad" step ran this time - campaign/ad_set/creative were
    // NOT re-created (that would double-spend against objects that
    // already exist at Meta).
    expect(retry.body.operation.steps.map((s: { step: string }) => s.step)).toEqual(["ad"]);

    const { data: afterRetry } = await admin.from("ad_campaigns").select("status, provider_state").eq("id", campaignId).single();
    expect(afterRetry?.status).toBe("active");
    expect(afterRetry?.provider_state.campaign.external_id).toBe(afterFailure?.provider_state.campaign.external_id); // same object, never recreated
    expect(afterRetry?.provider_state.ad).toBeTruthy();
  }, 20000);

  it("REGRESSION: two concurrent publish requests with DIFFERENT idempotency keys against the same campaign never both create a provider campaign - only one logical publish happens", async () => {
    const creativeId = await seedAdCreative(workspace.workspaceId, mediaAssetId, workspace.userId);
    const campaignId = await seedAdCampaign(workspace.workspaceId, integrationId, adAccountId, pageId, creativeId, workspace.userId, { status: "ready" });

    const [first, second] = await Promise.all([
      callPublish(token, campaignId, crypto.randomUUID()),
      callPublish(token, campaignId, crypto.randomUUID()),
    ]);

    // Exactly one request actually won the atomic claim and ran the saga;
    // the other was rejected (409) because the campaign was no longer in
    // 'ready'/'failed' status by the time its own claim UPDATE ran.
    const outcomes = [first, second].map((r) => r.status);
    expect(outcomes.filter((s) => s === 200)).toHaveLength(1);
    expect(outcomes.filter((s) => s === 409)).toHaveLength(1);

    const { data: campaign } = await admin.from("ad_campaigns").select("status, external_campaign_id").eq("id", campaignId).single();
    expect(campaign?.status).toBe("active");
    expect(campaign?.external_campaign_id).toMatch(/^mock_campaign_/);

    const { data: operations } = await admin.from("ad_publish_operations").select("id, status").eq("campaign_id", campaignId);
    expect(operations).toHaveLength(1); // the losing request never even created a second operation row
    expect(operations![0].status).toBe("succeeded");
  }, 20000);
});
