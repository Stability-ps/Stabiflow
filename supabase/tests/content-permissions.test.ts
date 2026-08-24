// Proves the Content module's permission model actually differentiates
// rank-peer roles (marketing/sales/support all rank 50 - see
// workspace_role_rank()) by name, not just membership. This is the direct
// test of Phase 5 safeguard #1: has_workspace_permission('content.create'/
// 'media.upload'), not has_workspace_role(), is what content_scheduled_posts
// and content_media_assets RLS actually checks.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";
import { seedFacebookPage, seedMediaAsset, seedWorkspaceIntegration } from "./contentHelpers";

describe("Content module permission matrix (content.create / media.upload)", () => {
  let workspace: TestTenant;
  let pageId: string;
  let assetId: string;
  let salesUser: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };
  let marketingUser: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };
  let viewerUser: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };

  beforeAll(async () => {
    workspace = await createTestTenant("perm-matrix");
    const integrationId = await seedWorkspaceIntegration(workspace.workspaceId);
    pageId = await seedFacebookPage(workspace.workspaceId, integrationId);
    const asset = await seedMediaAsset(workspace.workspaceId, workspace.userId);
    assetId = asset.id;

    const sales = await createTestUser("perm-sales");
    await seedMembership(workspace.workspaceId, sales.userId, "sales");
    salesUser = sales;

    const marketing = await createTestUser("perm-marketing");
    await seedMembership(workspace.workspaceId, marketing.userId, "marketing");
    marketingUser = marketing;

    const viewer = await createTestUser("perm-viewer");
    await seedMembership(workspace.workspaceId, viewer.userId, "viewer");
    viewerUser = viewer;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant({ userId: salesUser.userId });
    await cleanupTenant({ userId: marketingUser.userId });
    await cleanupTenant({ userId: viewerUser.userId });
  });

  it("a 'sales' member (rank-peer of marketing, view-only permissions) CANNOT create a scheduled post", async () => {
    const { data, error } = await salesUser.client
      .from("content_scheduled_posts")
      .insert({
        workspace_id: workspace.workspaceId,
        media_asset_id: assetId,
        target_platform: "facebook",
        facebook_page_id: pageId,
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
        caption: "sales should not be able to create this",
        status: "scheduled",
        idempotency_key: `sales-denied-${Date.now()}`,
      })
      .select();
    expect(data).toBeNull();
    expect(error).toBeTruthy(); // RLS with-check failure, not a silent no-op
  });

  it("a 'marketing' member (same rank as sales) CAN create a scheduled post - the two are differentiated by permission name, not rank", async () => {
    const { data, error } = await marketingUser.client
      .from("content_scheduled_posts")
      .insert({
        workspace_id: workspace.workspaceId,
        media_asset_id: assetId,
        target_platform: "facebook",
        facebook_page_id: pageId,
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
        caption: "marketing can create this",
        status: "scheduled",
        idempotency_key: `marketing-allowed-${Date.now()}`,
      })
      .select("id");
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("a 'viewer' member cannot upload/insert a media asset row (media.upload denied, media.view still allows reading)", async () => {
    const { data, error } = await viewerUser.client
      .from("content_media_assets")
      .insert({
        workspace_id: workspace.workspaceId,
        title: "viewer should not be able to create this",
        storage_path: `${workspace.workspaceId}/viewer-attempt-${Date.now()}.png`,
        mime_type: "image/png",
        width_px: 100,
        height_px: 100,
        aspect_ratio: 1,
        file_size_bytes: 100,
        checksum_sha256: "0".repeat(64),
      })
      .select();
    expect(data).toBeNull();
    expect(error).toBeTruthy();

    // But the viewer CAN see the workspace's existing media (media.view).
    const { data: readable, error: readError } = await viewerUser.client.from("content_media_assets").select("id").eq("id", assetId);
    expect(readError).toBeNull();
    expect(readable?.length).toBe(1);
  });
});
