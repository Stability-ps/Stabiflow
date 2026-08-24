// RELEASE BLOCKER: proves Workspace A cannot read, insert, update, or
// delete Workspace B's records - required before Content/Campaigns/
// WhatsApp UI work begins (Phase 4+). Runs against the real, live
// StabiFlow Supabase project (never Acapolite's) via supabase-js, the
// same client/API surface the actual app uses - not a mocked test, a
// genuine proof against deployed RLS policies.
//
// Run with: npm run test:integration
// Requires .env.test.local (gitignored) with SUPABASE_URL,
// SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY for the StabiFlow
// project - see .env.test.local.example.
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadTestEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../../.env.test.local");
  const raw = readFileSync(envPath, "utf8");
  const parsed: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    parsed[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
  }
  return parsed;
}

const env = loadTestEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const ANON_KEY = env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY in .env.test.local");
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

type TestTenant = { userId: string; email: string; client: SupabaseClient; workspaceId: string };

async function createTestTenant(label: string): Promise<TestTenant> {
  const email = `stabiflow-rls-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = crypto.randomUUID();

  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw new Error(`Failed to create test user ${label}: ${createError?.message}`);

  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw new Error(`Failed to sign in test user ${label}: ${signInError?.message}`);

  const { data: workspaceId, error: workspaceError } = await client.rpc("create_workspace", {
    p_name: `RLS Test Workspace ${label}`,
    p_slug: `rls-test-${label}-${Date.now()}`,
  });
  if (workspaceError || !workspaceId) throw new Error(`Failed to create workspace for ${label}: ${workspaceError?.message}`);

  return { userId: created.user.id, email, client, workspaceId: workspaceId as string };
}

let tenantA: TestTenant;
let tenantB: TestTenant;

beforeAll(async () => {
  tenantA = await createTestTenant("a");
  tenantB = await createTestTenant("b");
});

afterAll(async () => {
  // workspaces.created_by is ON DELETE SET NULL (not cascaded from
  // profiles), so the test workspaces need an explicit cleanup delete;
  // deleting the auth users cascades profiles -> workspace_members.
  for (const tenant of [tenantA, tenantB]) {
    if (!tenant) continue;
    await admin.from("workspaces").delete().eq("id", tenant.workspaceId);
    await admin.auth.admin.deleteUser(tenant.userId);
  }
});

describe("StabiFlow tenant isolation (release blocker)", () => {
  it("user A can select their own workspace", async () => {
    const { data } = await tenantA.client.from("workspaces").select("*").eq("id", tenantA.workspaceId);
    expect(data?.length).toBe(1);
  });

  it("user A cannot SELECT workspace B's workspace row", async () => {
    const { data } = await tenantA.client.from("workspaces").select("*").eq("id", tenantB.workspaceId);
    expect(data).toEqual([]);
  });

  it("user A cannot SELECT workspace B's members", async () => {
    const { data } = await tenantA.client.from("workspace_members").select("*").eq("workspace_id", tenantB.workspaceId);
    expect(data).toEqual([]);
  });

  it("user A cannot UPDATE workspace B's name, and the name genuinely never changes", async () => {
    const { data } = await tenantA.client.from("workspaces").update({ name: "Hacked by A" }).eq("id", tenantB.workspaceId).select();
    expect(data ?? []).toEqual([]);
    const { data: check } = await admin.from("workspaces").select("name").eq("id", tenantB.workspaceId).single();
    expect(check?.name).not.toBe("Hacked by A");
  });

  it("user A cannot UPDATE workspace B's settings", async () => {
    const { data } = await tenantA.client.from("workspace_settings").update({ timezone: "Pacific/Auckland" }).eq("workspace_id", tenantB.workspaceId).select();
    expect(data ?? []).toEqual([]);
    const { data: check } = await admin.from("workspace_settings").select("timezone").eq("workspace_id", tenantB.workspaceId).single();
    expect(check?.timezone).not.toBe("Pacific/Auckland");
  });

  it("user A cannot DELETE workspace B", async () => {
    await tenantA.client.from("workspaces").delete().eq("id", tenantB.workspaceId);
    const { data: check } = await admin.from("workspaces").select("id").eq("id", tenantB.workspaceId).maybeSingle();
    expect(check).not.toBeNull();
  });

  it("user A cannot INSERT an attribution_event scoped to workspace B", async () => {
    const { error } = await tenantA.client.from("attribution_events").insert({ workspace_id: tenantB.workspaceId, event_type: "lead_created" });
    expect(error).not.toBeNull();
  });

  it("user A CAN insert an attribution_event scoped to their own workspace", async () => {
    const { error } = await tenantA.client.from("attribution_events").insert({ workspace_id: tenantA.workspaceId, event_type: "lead_created" });
    expect(error).toBeNull();
  });

  it("user A cannot INSERT a workspace_activity_log row scoped to workspace B", async () => {
    const { error } = await tenantA.client.from("workspace_activity_log").insert({ workspace_id: tenantB.workspaceId, action: "test", target_type: "test" });
    expect(error).not.toBeNull();
  });

  it("user A cannot INSERT a workspace_integrations row scoped to workspace B", async () => {
    const { error } = await tenantA.client.from("workspace_integrations").insert({ workspace_id: tenantB.workspaceId, provider: "meta" });
    expect(error).not.toBeNull();
  });

  it("user A cannot read workspace B's pending invitations", async () => {
    await admin.from("workspace_invitations").insert({ workspace_id: tenantB.workspaceId, email: "someone@example.com", invited_by: tenantB.userId });
    const { data } = await tenantA.client.from("workspace_invitations").select("*").eq("workspace_id", tenantB.workspaceId);
    expect(data).toEqual([]);
  });

  it("user A cannot read workspace B's provider connections (Facebook/Instagram/ad accounts/WhatsApp numbers)", async () => {
    const { data: integration } = await admin
      .from("workspace_integrations")
      .insert({ workspace_id: tenantB.workspaceId, provider: "whatsapp" })
      .select("id")
      .single();
    await admin.from("workspace_whatsapp_numbers").insert({
      workspace_id: tenantB.workspaceId,
      integration_id: integration!.id,
      phone_number_id: `test-${Date.now()}`,
    });
    const { data } = await tenantA.client.from("workspace_whatsapp_numbers").select("*").eq("workspace_id", tenantB.workspaceId);
    expect(data).toEqual([]);
  });

  it("is_workspace_member() says false for a non-member and true for the actual owner", async () => {
    const { data: notMember } = await tenantA.client.rpc("is_workspace_member", { p_workspace_id: tenantB.workspaceId });
    expect(notMember).toBe(false);
    const { data: isOwner } = await tenantA.client.rpc("is_workspace_member", { p_workspace_id: tenantA.workspaceId });
    expect(isOwner).toBe(true);
  });

  it("has_workspace_role() says false for a non-member and true for the actual owner", async () => {
    const { data: notMember } = await tenantA.client.rpc("has_workspace_role", { p_workspace_id: tenantB.workspaceId, p_min_role: "viewer" });
    expect(notMember).toBe(false);
    const { data: isOwner } = await tenantA.client.rpc("has_workspace_role", { p_workspace_id: tenantA.workspaceId, p_min_role: "owner" });
    expect(isOwner).toBe(true);
  });

  it("an unauthenticated client (no session at all) cannot read any workspace", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data } = await anon.from("workspaces").select("*");
    expect(data).toEqual([]);
  });

  it("a decrypted integration secret is never reachable through the client API, even for an authenticated admin", async () => {
    // get_workspace_integration_secret is REVOKEd from anon/authenticated
    // and GRANTed only to service_role at the SQL level - calling it as a
    // normal authenticated user must fail outright, not just return null.
    const { error } = await tenantA.client.rpc("get_workspace_integration_secret", {
      p_integration_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).not.toBeNull();
  });
});
