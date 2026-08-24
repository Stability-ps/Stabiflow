import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
export const SUPABASE_URL = env.SUPABASE_URL;
export const ANON_KEY = env.SUPABASE_ANON_KEY;
export const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY in .env.test.local");
}

export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export type TestTenant = { userId: string; email: string; client: SupabaseClient; workspaceId: string };

/** Signs up a fresh user (via the Admin API) and has them create their own new workspace - they become its owner. */
export async function createTestTenant(label: string): Promise<TestTenant> {
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

/** Signs up a fresh user with NO workspace of their own - a blank slate to be seeded into someone else's workspace, or to prove they can't self-serve one. */
export async function createTestUser(label: string): Promise<{ userId: string; email: string; client: SupabaseClient }> {
  const email = `stabiflow-rls-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = crypto.randomUUID();
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw new Error(`Failed to create test user ${label}: ${createError?.message}`);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw new Error(`Failed to sign in test user ${label}: ${signInError?.message}`);
  return { userId: created.user.id, email, client };
}

/** Seeds a workspace_members row directly via the service role (bypasses RLS) - used to place a test user at a specific role without going through the invitation flow, so escalation tests start from a known role. */
export async function seedMembership(workspaceId: string, userId: string, role: string) {
  const { error } = await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role });
  if (error) throw new Error(`Failed to seed membership: ${error.message}`);
}

export async function cleanupTenant(tenant: { userId: string; workspaceId?: string }) {
  if (tenant.workspaceId) await admin.from("workspaces").delete().eq("id", tenant.workspaceId);
  await admin.auth.admin.deleteUser(tenant.userId);
}
