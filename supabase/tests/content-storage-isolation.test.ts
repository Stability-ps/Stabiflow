// Storage-layer isolation for the content-media bucket. Every check here
// is against REAL storage.objects RLS, using genuinely independent
// authenticated sessions and a real uploaded PNG - not a simulated policy
// evaluation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, type TestTenant } from "./helpers";
import { uploadRealTestObject } from "./contentHelpers";

describe("content-media storage isolation (release blocker)", () => {
  let workspaceA: TestTenant;
  let workspaceB: TestTenant;
  let objectPathB: string;

  beforeAll(async () => {
    workspaceA = await createTestTenant("storage-a");
    workspaceB = await createTestTenant("storage-b");
    objectPathB = await uploadRealTestObject(workspaceB.client, workspaceB.workspaceId);
  });

  afterAll(async () => {
    await cleanupTenant(workspaceA);
    await cleanupTenant(workspaceB);
    await admin.storage.from("content-media").remove([objectPathB]);
  });

  it("workspace A cannot download workspace B's real uploaded object", async () => {
    const { data, error } = await workspaceA.client.storage.from("content-media").download(objectPathB);
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("workspace A cannot create a signed URL for workspace B's object (signed-URL generation checks membership)", async () => {
    const { data, error } = await workspaceA.client.storage.from("content-media").createSignedUrl(objectPathB, 60);
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("workspace A cannot upload INTO workspace B's path prefix (path spoofing is blocked, not just their own path being required)", async () => {
    const spoofedPath = `${workspaceB.workspaceId}/spoofed-${Date.now()}.png`;
    const file = new File([Uint8Array.from([1, 2, 3, 4])], "x.png", { type: "image/png" });
    const { error } = await workspaceA.client.storage.from("content-media").upload(spoofedPath, file);
    expect(error).toBeTruthy();
  });

  it("workspace A CAN upload into their own workspace-prefixed path (the policy isn't accidentally blocking everyone)", async () => {
    const ownPath = `${workspaceA.workspaceId}/legit-${Date.now()}.png`;
    const file = new File([Uint8Array.from([1, 2, 3, 4])], "x.png", { type: "image/png" });
    const { error } = await workspaceA.client.storage.from("content-media").upload(ownPath, file);
    expect(error).toBeNull();
    await admin.storage.from("content-media").remove([ownPath]);
  });

  it("workspace A cannot list/delete workspace B's object via the raw storage API", async () => {
    const { error } = await workspaceA.client.storage.from("content-media").remove([objectPathB]);
    // Supabase Storage's remove() on a non-visible object reports success
    // with an empty result rather than a 403 (matches its general "RLS
    // filters, doesn't error" semantics) - the only thing that actually
    // matters is that the object still exists afterward.
    void error;
    const { data: stillThere } = await admin.storage.from("content-media").download(objectPathB);
    expect(stillThere).toBeTruthy();
  });

  it("after workspace A's owner is removed from their own workspace, they lose access to even their OWN objects", async () => {
    const ownPath = `${workspaceA.workspaceId}/before-removal-${Date.now()}.png`;
    const file = new File([Uint8Array.from([5, 6, 7, 8])], "x.png", { type: "image/png" });
    await workspaceA.client.storage.from("content-media").upload(ownPath, file);

    await admin.from("workspace_members").delete().eq("workspace_id", workspaceA.workspaceId).eq("user_id", workspaceA.userId);

    const { data, error } = await workspaceA.client.storage.from("content-media").download(ownPath);
    expect(data).toBeNull();
    expect(error).toBeTruthy();

    await admin.storage.from("content-media").remove([ownPath]);
  });
});
