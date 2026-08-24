// Real, live-project integration tests (no mocks) proving Phase 5's
// required cross-tenant isolation properties for the Content module,
// following the same pattern as tenant-isolation.test.ts and
// role-escalation.test.ts: genuinely independent authenticated sessions
// against the actual deployed RLS policies, not a simulated permission
// check.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedFacebookPage, seedMediaAsset, seedScheduledPost, seedWorkspaceIntegration } from "./contentHelpers";

describe("Content module tenant isolation (release blocker)", () => {
  let workspaceA: TestTenant;
  let workspaceB: TestTenant;
  let integrationB: string;
  let pageB: string;
  let assetB: { id: string; storage_path: string };
  let postB: string;

  beforeAll(async () => {
    workspaceA = await createTestTenant("content-a");
    workspaceB = await createTestTenant("content-b");
    integrationB = await seedWorkspaceIntegration(workspaceB.workspaceId);
    pageB = await seedFacebookPage(workspaceB.workspaceId, integrationB);
    assetB = await seedMediaAsset(workspaceB.workspaceId, workspaceB.userId);
    postB = await seedScheduledPost(workspaceB.workspaceId, assetB.id, pageB);
  });

  afterAll(async () => {
    await cleanupTenant(workspaceA);
    await cleanupTenant(workspaceB);
  });

  it("workspace A cannot read workspace B's media assets", async () => {
    const { data, error } = await workspaceA.client.from("content_media_assets").select("*").eq("id", assetB.id);
    expect(error).toBeNull();
    expect(data).toEqual([]); // RLS silently filters, matching Postgres RLS semantics - not an error, just zero rows
  });

  it("workspace A cannot read workspace B's scheduled posts", async () => {
    const { data, error } = await workspaceA.client.from("content_scheduled_posts").select("*").eq("id", postB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("workspace A cannot UPDATE workspace B's scheduled post, and it genuinely never changes", async () => {
    const { data } = await workspaceA.client
      .from("content_scheduled_posts")
      .update({ caption: "hijacked by workspace A" })
      .eq("id", postB)
      .select();
    expect(data).toEqual([]); // 0 rows affected

    const { data: stillOriginal } = await admin.from("content_scheduled_posts").select("caption").eq("id", postB).single();
    expect(stillOriginal?.caption).toBe("Test caption");
  });

  it("workspace A cannot DELETE workspace B's media asset", async () => {
    await workspaceA.client.from("content_media_assets").delete().eq("id", assetB.id);
    const { data: stillExists } = await admin.from("content_media_assets").select("id").eq("id", assetB.id).maybeSingle();
    expect(stillExists?.id).toBe(assetB.id);
  });

  it("workspace A cannot read workspace B's platform variants", async () => {
    const { data: variant } = await admin
      .from("content_platform_variants")
      .insert({ workspace_id: workspaceB.workspaceId, media_asset_id: assetB.id, platform: "instagram", storage_path: `${workspaceB.workspaceId}/variants/x.jpg`, width_px: 1080, height_px: 1080, aspect_ratio: 1, mime_type: "image/jpeg", file_size_bytes: 500 })
      .select("id")
      .single();
    expect(variant).toBeTruthy();

    const { data, error } = await workspaceA.client.from("content_platform_variants").select("*").eq("id", variant!.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("workspace A cannot manually publish workspace B's scheduled post (content-publish-now)", async () => {
    const { data: session } = await workspaceA.client.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/content-publish-now`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ scheduled_post_id: postB }),
    });
    expect(res.status).toBe(404); // RLS's content.view select policy means it doesn't even exist from workspace A's perspective
    const { data: stillScheduled } = await admin.from("content_scheduled_posts").select("status").eq("id", postB).single();
    expect(stillScheduled?.status).toBe("scheduled"); // never claimed, never touched
  });

  it("workspace A cannot alter workspace B's content_scheduler_settings", async () => {
    const { data: session } = await workspaceA.client.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/content-scheduler-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ action: "set", workspace_id: workspaceB.workspaceId, auto_publish_enabled: true }),
    });
    expect(res.status).toBe(403); // has_workspace_role(workspaceB, 'admin') is false for a non-member
    const { data: stillOff } = await admin.from("content_scheduler_settings").select("auto_publish_enabled").eq("workspace_id", workspaceB.workspaceId).single();
    expect(stillOff?.auto_publish_enabled).toBe(false);
  });

  it("even a DIRECT service-role insert cannot make a workspace B post reference a workspace A destination - the workspace-consistency trigger blocks it regardless of RLS", async () => {
    // This bypasses RLS entirely (service role) to prove the defense is at
    // the trigger/constraint layer, not just the policy layer - exactly
    // the "Workspace A scheduled post cannot resolve Workspace B social
    // account" property, proven from the strongest possible caller.
    const integrationA = await seedWorkspaceIntegration(workspaceA.workspaceId);
    const pageA = await seedFacebookPage(workspaceA.workspaceId, integrationA);

    const { error } = await admin.from("content_scheduled_posts").insert({
      workspace_id: workspaceB.workspaceId, // post belongs to workspace B...
      media_asset_id: assetB.id,
      target_platform: "facebook",
      facebook_page_id: pageA, // ...but points at workspace A's Facebook Page
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      caption: "cross-tenant attempt",
      status: "scheduled",
      idempotency_key: `cross-tenant-${Date.now()}`,
    });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/facebook_page_id must belong to the same workspace/);
  });
});
