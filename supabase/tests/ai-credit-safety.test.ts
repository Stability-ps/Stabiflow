// AI credits are only spent on AI work that actually runs
// (content-ai-caption ordering + 20261024070000_refund_entitlement).
// LOCAL Supabase, real function, no OpenAI key configured locally.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, type TestTenant } from "./helpers";

let tenant: TestTenant;
let assetId: string;
const period = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);

async function used(workspaceId: string) {
  const { data } = await admin.from("entitlement_usage").select("used").eq("workspace_id", workspaceId).eq("entitlement_key", "ai_credits").eq("period_start", period()).maybeSingle();
  return Number(data?.used ?? 0);
}

beforeAll(async () => {
  tenant = await createTestTenant("ai-credit-safety");
  await admin.from("workspace_entitlement_overrides").upsert({ workspace_id: tenant.workspaceId, entitlement_key: "ai_credits", limit_value: 5, reason: "ai credit safety test" }, { onConflict: "workspace_id,entitlement_key" });
  const { data, error } = await admin.from("content_media_assets").insert({
    workspace_id: tenant.workspaceId, title: "test", storage_path: `${tenant.workspaceId}/test.png`, mime_type: "image/png",
    width_px: 1080, height_px: 1080, aspect_ratio: 1, file_size_bytes: 1000, checksum_sha256: "a".repeat(64),
  }).select("id").single();
  if (error) throw new Error(error.message);
  assetId = data.id;
});

afterAll(async () => cleanupTenant(tenant));

describe("content-ai-caption credit handling", () => {
  it("does not consume a credit when AI is not configured", async () => {
    const before = await used(tenant.workspaceId);
    const { error } = await tenant.client.functions.invoke("content-ai-caption", { body: { workspace_id: tenant.workspaceId, media_asset_id: assetId } });
    expect((error as { context?: { status?: number } } | null)?.context?.status).toBe(503);
    expect(await used(tenant.workspaceId)).toBe(before);
  });
});

describe("refund_entitlement", () => {
  it("gives back consumed allowance and never goes below zero", async () => {
    await admin.rpc("consume_entitlement", { p_workspace_id: tenant.workspaceId, p_key: "ai_credits", p_amount: 2 });
    const after = await used(tenant.workspaceId);
    await admin.rpc("refund_entitlement", { p_workspace_id: tenant.workspaceId, p_key: "ai_credits", p_amount: 1 });
    expect(await used(tenant.workspaceId)).toBe(after - 1);
    await admin.rpc("refund_entitlement", { p_workspace_id: tenant.workspaceId, p_key: "ai_credits", p_amount: 50 });
    expect(await used(tenant.workspaceId)).toBe(0);
  });

  it("cannot be called by a customer", async () => {
    const { error } = await tenant.client.rpc("refund_entitlement", { p_workspace_id: tenant.workspaceId, p_key: "ai_credits", p_amount: 1 });
    expect(error?.message).toMatch(/permission denied/i);
  });
});
