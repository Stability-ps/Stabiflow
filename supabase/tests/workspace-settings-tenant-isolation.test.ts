// Phase B: tenant isolation for the new workspace-assets storage bucket and
// the is_workspace_slug_available() cross-tenant helper. Direct
// workspace_settings/workspaces column updates are already covered
// generically by tenant-isolation.test.ts ("user A cannot UPDATE workspace
// B's settings") - the new columns added in this phase share that exact
// same RLS policy, so they don't need a duplicate test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";

const ONE_PIXEL_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

describe("workspace-assets storage isolation (release blocker)", () => {
  let workspaceA: TestTenant;
  let workspaceB: TestTenant;
  let objectPathB: string;

  beforeAll(async () => {
    workspaceA = await createTestTenant("ws-assets-a");
    workspaceB = await createTestTenant("ws-assets-b");
    objectPathB = `${workspaceB.workspaceId}/logo-${Date.now()}.png`;
    const file = new File([ONE_PIXEL_PNG], "pixel.png", { type: "image/png" });
    const { error } = await workspaceB.client.storage.from("workspace-assets").upload(objectPathB, file, { contentType: "image/png" });
    if (error) throw new Error(`Failed to seed workspace-assets object: ${error.message}`);
  });

  afterAll(async () => {
    await cleanupTenant(workspaceA);
    await cleanupTenant(workspaceB);
  });

  it("workspace A (owner) cannot download workspace B's logo object", async () => {
    const { data, error } = await workspaceA.client.storage.from("workspace-assets").download(objectPathB);
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("workspace A cannot create a signed URL for workspace B's object", async () => {
    const { data, error } = await workspaceA.client.storage.from("workspace-assets").createSignedUrl(objectPathB, 60);
    expect(error).toBeTruthy();
    expect(data).toBeNull();
  });

  it("workspace A cannot upload into workspace B's path prefix (path spoofing is blocked)", async () => {
    const file = new File([ONE_PIXEL_PNG], "pixel.png", { type: "image/png" });
    const { error } = await workspaceA.client.storage.from("workspace-assets").upload(`${workspaceB.workspaceId}/logo-spoofed.png`, file, { contentType: "image/png" });
    expect(error).toBeTruthy();
  });

  it("workspace A (owner) CAN upload into their own workspace-prefixed path", async () => {
    const file = new File([ONE_PIXEL_PNG], "pixel.png", { type: "image/png" });
    const path = `${workspaceA.workspaceId}/logo-${Date.now()}.png`;
    const { error } = await workspaceA.client.storage.from("workspace-assets").upload(path, file, { contentType: "image/png" });
    expect(error).toBeNull();
  });

  it("a non-admin member cannot upload a logo, even into their OWN workspace's path (admin-only bucket)", async () => {
    const viewer = await createTestUser("ws-assets-viewer");
    await seedMembership(workspaceA.workspaceId, viewer.userId, "viewer");
    const file = new File([ONE_PIXEL_PNG], "pixel.png", { type: "image/png" });
    const path = `${workspaceA.workspaceId}/logo-viewer-attempt.png`;
    const { error } = await viewer.client.storage.from("workspace-assets").upload(path, file, { contentType: "image/png" });
    expect(error).toBeTruthy();
    await cleanupTenant({ userId: viewer.userId });
  });
});

describe("is_workspace_slug_available() (release blocker)", () => {
  let workspaceA: TestTenant;

  beforeAll(async () => {
    workspaceA = await createTestTenant("slug-check-a");
  });

  afterAll(async () => {
    await cleanupTenant(workspaceA);
  });

  it("returns false for a slug already taken by ANOTHER workspace, without exposing that workspace's data", async () => {
    const { data: workspaceRow } = await admin.from("workspaces").select("slug").eq("id", workspaceA.workspaceId).single();
    const outsider = await createTestUser("slug-check-outsider");
    const { data, error } = await outsider.client.rpc("is_workspace_slug_available", { p_slug: workspaceRow!.slug });
    expect(error).toBeNull();
    expect(data).toBe(false); // taken - but the RPC never returned any row data about workspace A
    await cleanupTenant({ userId: outsider.userId });
  });

  it("returns true for a genuinely unused slug", async () => {
    const { data, error } = await workspaceA.client.rpc("is_workspace_slug_available", { p_slug: `definitely-unused-${Date.now()}` });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("excludes the given workspace id, so a workspace checking its OWN current slug sees it as available", async () => {
    const { data: workspaceRow } = await admin.from("workspaces").select("slug").eq("id", workspaceA.workspaceId).single();
    const { data, error } = await workspaceA.client.rpc("is_workspace_slug_available", { p_slug: workspaceRow!.slug, p_exclude_workspace_id: workspaceA.workspaceId });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });
});
