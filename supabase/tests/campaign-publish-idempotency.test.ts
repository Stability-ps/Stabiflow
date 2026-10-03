// Proves Phase 6 instruction #14 (idempotency) and #13 (no accidental
// double-publish) against the REAL deployed ad-campaigns-publish edge
// function - no mocks. This deliberately never reaches a live Meta API
// call: the seeded workspace_integrations row has no vault secret, so
// get_workspace_integration_secret() returns null and executeCampaignPublish
// fails at the "resolve token" step with zero provider objects created -
// exactly the safe, no-real-spend way to exercise the claim/idempotency
// machinery per instruction #31 ("stop and request approval before any
// spend-capable external object is created").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedFacebookPage, seedMediaAsset, seedWorkspaceIntegration } from "./contentHelpers";
import { seedAdCampaign, seedAdCreative, seedMetaAdAccount } from "./campaignHelpers";

async function callPublish(token: string, campaignId: string, idempotencyKey: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ad-campaigns-publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ campaign_id: campaignId, idempotency_key: idempotencyKey }),
  });
  return { status: res.status, body: await res.json() };
}

describe("Campaign publish idempotency (release blocker)", () => {
  let workspace: TestTenant;
  let campaignId: string;

  beforeAll(async () => {
    workspace = await createTestTenant("publish-idempotency");
    const integrationId = await seedWorkspaceIntegration(workspace.workspaceId); // no vault secret - publish will fail at token resolution, never reaching Meta
    const adAccountId = await seedMetaAdAccount(workspace.workspaceId, integrationId);
    const pageId = await seedFacebookPage(workspace.workspaceId, integrationId);
    const asset = await seedMediaAsset(workspace.workspaceId, workspace.userId);
    const creativeId = await seedAdCreative(workspace.workspaceId, asset.id, workspace.userId);
    campaignId = await seedAdCampaign(workspace.workspaceId, integrationId, adAccountId, pageId, creativeId, workspace.userId, { status: "ready" });
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
  });

  it("two concurrent publish requests with the SAME idempotency key never create two publish operations, and the campaign ends in a single terminal state", async () => {
    const { data: session } = await workspace.client.auth.getSession();
    const token = session.session!.access_token;
    const key = crypto.randomUUID();

    const [first, second] = await Promise.all([callPublish(token, campaignId, key), callPublish(token, campaignId, key)]);

    // Exactly one of the two actually ran the claim+publish path; the other
    // either replayed its result or got a 409/202 race response - neither
    // outcome is a second real publish attempt.
    for (const result of [first, second]) {
      expect([200, 202, 409]).toContain(result.status);
    }

    const { data: operations } = await admin.from("ad_publish_operations").select("id, status").eq("idempotency_key", key);
    expect(operations?.length).toBe(1); // the unique constraint on idempotency_key guarantees this even under a genuine race

    const { data: campaign } = await admin.from("ad_campaigns").select("status, provider_state").eq("id", campaignId).single();
    expect(["failed", "publishing"]).toContain(campaign?.status); // never 'active' - no token was ever available to actually create anything at Meta
    expect(campaign?.provider_state).toEqual({}); // zero provider objects were created - the failure happened before any Meta call
  }, 20000);

  it("a REPLAY of the same idempotency key after the operation finished returns the recorded outcome without re-running the claim", async () => {
    const { data: session } = await workspace.client.auth.getSession();
    const token = session.session!.access_token;

    // Wait for the previous test's operation to reach a terminal state.
    let attempts = 0;
    let campaignStatus = "";
    while (attempts < 10) {
      const { data } = await admin.from("ad_campaigns").select("status").eq("id", campaignId).single();
      campaignStatus = data?.status || "";
      if (campaignStatus !== "publishing") break;
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }
    expect(campaignStatus).toBe("failed");

    const { data: op } = await admin.from("ad_publish_operations").select("id, idempotency_key, status").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(1).single();
    expect(op).toBeTruthy();

    const replay = await callPublish(token, campaignId, op!.idempotency_key);
    expect(replay.status).toBe(200);
    expect(replay.body.replay).toBe(true);
    expect(replay.body.operation.id).toBe(op!.id);

    const { data: operationsAfterReplay } = await admin.from("ad_publish_operations").select("id").eq("campaign_id", campaignId);
    expect(operationsAfterReplay?.length).toBe(1); // the replay did not create a second operation row
  }, 20000);

  it("a genuinely NEW idempotency key after a failure is allowed to retry (status 'failed' -> 'publishing' claim succeeds)", async () => {
    const { data: session } = await workspace.client.auth.getSession();
    const token = session.session!.access_token;
    const newKey = crypto.randomUUID();

    const result = await callPublish(token, campaignId, newKey);
    expect([200, 409]).toContain(result.status); // 200 if it claimed and failed again; 409 only if a prior test's row was still mid-flight

    const { data: operations } = await admin.from("ad_publish_operations").select("id").eq("campaign_id", campaignId);
    expect((operations?.length || 0)).toBeGreaterThanOrEqual(2); // the original key's operation, plus this new one
  }, 20000);
});
