// AI credits are only spent on AI work that actually runs
// (content-ai-caption / creative-studio-* ordering + 20261024070000_refund_entitlement).
// LOCAL Supabase, real function, no OpenAI key configured locally.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, enableModules, SUPABASE_URL, type TestTenant } from "./helpers";

let tenant: TestTenant;
let assetId: string;
const period = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);

async function used(workspaceId: string, key = "ai_credits") {
  const { data } = await admin.from("entitlement_usage").select("used").eq("workspace_id", workspaceId).eq("entitlement_key", key).eq("period_start", period()).maybeSingle();
  return Number(data?.used ?? 0);
}

beforeAll(async () => {
  tenant = await createTestTenant("ai-credit-safety");
  await enableModules(tenant.workspaceId, "module.content");
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

describe("creative-studio credit handling", () => {
  it("does not consume a generation when AI is not configured", async () => {
    await enableModules(tenant.workspaceId, "module.creative_studio");
    await admin.from("workspace_entitlement_overrides").upsert({ workspace_id: tenant.workspaceId, entitlement_key: "creative_generations", limit_value: 5, reason: "ai credit safety test" }, { onConflict: "workspace_id,entitlement_key" });
    const before = await used(tenant.workspaceId, "creative_generations");
    const { error } = await tenant.client.functions.invoke("creative-studio-generate", { body: { workspace_id: tenant.workspaceId, business_context: "A bakery in Durban" } });
    expect((error as { context?: { status?: number } } | null)?.context?.status).toBe(503);
    expect(await used(tenant.workspaceId, "creative_generations")).toBe(before);
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

// Creative Studio and Flow AI are plan-gated server-side (same evaluator as
// the UI): a workspace without the module is refused before any allowance is
// charged, any conversation is created, or any provider is called.
describe("module plan gates on AI functions", () => {
  let free: TestTenant;
  beforeAll(async () => {
    free = await createTestTenant("ai-gate-free");
    await admin.from("workspace_entitlement_overrides").upsert({ workspace_id: free.workspaceId, entitlement_key: "creative_generations", limit_value: 5, reason: "ai gate test" }, { onConflict: "workspace_id,entitlement_key" });
  });
  afterAll(async () => cleanupTenant(free));

  for (const fn of ["creative-studio-generate", "creative-studio-concepts", "creative-studio-visuals"]) {
    it(`${fn} refuses a workspace without Creative Studio and charges nothing`, async () => {
      const before = await used(free.workspaceId, "creative_generations");
      const { data: session } = await free.client.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session!.access_token}` },
        body: JSON.stringify({ workspace_id: free.workspaceId, business_context: "A bakery in Durban", batch_id: "00000000-0000-4000-8000-000000000001" }),
      });
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.code).toBe("MODULE_NOT_IN_PLAN");
      expect(await used(free.workspaceId, "creative_generations")).toBe(before);
    });
  }

  it("content-ai-caption refuses a workspace without Content and charges nothing", async () => {
    const before = await used(free.workspaceId);
    const { data: session } = await free.client.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/content-ai-caption`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session!.access_token}` },
      body: JSON.stringify({ workspace_id: free.workspaceId, media_asset_id: "00000000-0000-4000-8000-000000000002" }),
    });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe("MODULE_NOT_IN_PLAN");
    expect(body.error).toMatch(/Business and Growth plans/);
    expect(await used(free.workspaceId)).toBe(before);
  });

  it("flow-ai-chat refuses a workspace without Flow AI and creates no conversation", async () => {
    const { data: session } = await free.client.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/flow-ai-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session!.access_token}` },
      body: JSON.stringify({ workspaceId: free.workspaceId, message: "How many leads do I have?" }),
    });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe("MODULE_NOT_IN_PLAN");
    const { count } = await admin.from("ai_conversations").select("id", { count: "exact", head: true }).eq("workspace_id", free.workspaceId);
    expect(count).toBe(0);
  });

  it("flow-ai-chat answers a non-member as not authorized, not with the workspace's plan", async () => {
    const outsider = await createTestTenant("ai-gate-outsider");
    const { data: session } = await outsider.client.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/flow-ai-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session!.access_token}` },
      body: JSON.stringify({ workspaceId: free.workspaceId, message: "hi" }),
    });
    const body = await res.json();
    await cleanupTenant(outsider);
    expect(res.status).toBe(403);
    expect(body.code).toBeUndefined();
  });
});
