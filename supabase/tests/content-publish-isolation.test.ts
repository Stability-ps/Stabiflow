// Publish-isolation properties proven against the REAL deployed database
// (not a fake store - contentPublishExecution.test.ts already proves the
// claim/execute logic itself in isolation with an in-memory fake; this
// file proves the same atomic-claim SQL pattern is actually atomic under
// real Postgres concurrency, and that the idempotency-key unique
// constraint really is enforced by the live schema). No provider calls are
// made here at all - Meta is never contacted, per the Phase 5 instruction
// to use mocks/logic-level proof rather than live external test publishing
// without explicit authorization.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, type TestTenant } from "./helpers";
import { seedFacebookPage, seedMediaAsset, seedScheduledPost, seedWorkspaceIntegration } from "./contentHelpers";

async function claim(postId: string, claimedBy: string) {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("content_scheduled_posts")
    .update({ status: "publishing", claimed_at: nowIso, claimed_by: claimedBy, updated_at: nowIso })
    .eq("id", postId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  return data;
}

describe("Content publish isolation (release blocker)", () => {
  let workspace: TestTenant;
  let assetId: string;
  let pageId: string;

  beforeAll(async () => {
    workspace = await createTestTenant("publish-isolation");
    const integrationId = await seedWorkspaceIntegration(workspace.workspaceId);
    pageId = await seedFacebookPage(workspace.workspaceId, integrationId);
    const asset = await seedMediaAsset(workspace.workspaceId, workspace.userId);
    assetId = asset.id;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
  });

  it("REGRESSION: two truly concurrent claim requests against the same real row - exactly one wins", async () => {
    const postId = await seedScheduledPost(workspace.workspaceId, assetId, pageId);

    const [a, b] = await Promise.all([claim(postId, "worker-A"), claim(postId, "worker-B")]);
    const winners = [a, b].filter(Boolean);
    expect(winners.length).toBe(1); // never both, never zero

    const { data: finalRow } = await admin.from("content_scheduled_posts").select("status, claimed_by").eq("id", postId).single();
    expect(finalRow?.status).toBe("publishing");
  });

  it("a post already 'publishing' (claimed) cannot be claimed again - the cron worker cannot double-publish an in-flight post", async () => {
    const postId = await seedScheduledPost(workspace.workspaceId, assetId, pageId, { status: "publishing", claimed_at: new Date().toISOString(), claimed_by: "worker-first" });
    const secondClaim = await claim(postId, "worker-second");
    expect(secondClaim).toBeNull();
  });

  it("an already-published post cannot be reclaimed", async () => {
    const postId = await seedScheduledPost(workspace.workspaceId, assetId, pageId, { status: "published", published_at: new Date().toISOString() });
    const claimAttempt = await claim(postId, "worker-late");
    expect(claimAttempt).toBeNull();
  });

  it("retries preserve idempotency: a second insert with the SAME idempotency_key is rejected by the unique constraint", async () => {
    const sharedKey = `idempotency-retry-test-${Date.now()}`;
    await seedScheduledPost(workspace.workspaceId, assetId, pageId, { idempotency_key: sharedKey });

    const { error } = await admin.from("content_scheduled_posts").insert({
      workspace_id: workspace.workspaceId,
      media_asset_id: assetId,
      target_platform: "facebook",
      facebook_page_id: pageId,
      scheduled_at: new Date(Date.now() + 7200_000).toISOString(),
      caption: "retry of the same logical slot",
      status: "scheduled",
      idempotency_key: sharedKey, // identical key - simulates a retried activation/regeneration
    });
    expect(error).toBeTruthy();
    expect(error?.code).toBe("23505"); // unique_violation
  });
});
