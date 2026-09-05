import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolution order for the connection trio: process.env WINS over the
// .env.test.local file. The file (see .env.test.local.example) is the
// normal path and points at the linked REMOTE project - correct for the
// suites that exercise deployed Edge Functions. The process-env overlay
// lets an explicit wrapper (`npm run test:integration:local`, which reads
// `supabase status`) point the DB-only Phase 1 read-model suites at LOCAL
// Supabase, whose migration is intentionally not pushed to remote. The
// file is optional only when the full trio is supplied via process.env;
// the loud throw below still fires if it is incomplete from BOTH sources,
// so a misconfigured env fails rather than silently skipping coverage.
// Nothing here relaxes RLS/auth: every test still runs through a real,
// independently-authenticated session.
function loadTestEnv(): Record<string, string> {
  const parsed: Record<string, string> = {};
  const envPath = path.resolve(__dirname, "../../.env.test.local");
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;
      parsed[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (process.env[key]) parsed[key] = process.env[key] as string;
  }
  return parsed;
}

const env = loadTestEnv();
export const SUPABASE_URL = env.SUPABASE_URL;
export const ANON_KEY = env.SUPABASE_ANON_KEY;
export const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY (.env.test.local or process env)");
}

/** Reads any other value from .env.test.local (e.g. a dev-only shared secret a test needs to compute a matching signature against a deployed edge function), with process.env taking precedence. Throws if missing so a misconfigured test env fails loudly rather than silently skipping coverage. */
export function getTestEnv(key: string): string {
  const value = process.env[key] ?? env[key];
  if (!value) throw new Error(`Missing ${key} in .env.test.local (or the process environment)`);
  return value;
}

export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// --- Shared/reusable test identity pool -------------------------------------
//
// Every RLS test needs a REAL, independently-authenticated session (a
// mocked/forged JWT would prove nothing about RLS) - but it does NOT need a
// BRAND NEW Auth signup+signin per test. Signup/signin both count against
// Supabase Auth's per-IP sign_in_sign_ups rate limit, and the old design
// (one fresh createUser+signInWithPassword per createTestTenant/
// createTestUser call) meant the total signin volume grew with the number
// of tests, not the number of DISTINCT people any single test actually
// needs at once - by Phase C the full suite was performing 50-90 signins
// in a single run and intermittently tripping the limit.
//
// Fix: a small, fixed pool of identities, created (idempotently - looked up
// by email first) and signed in ONCE per process, then handed out via a
// round-robin cursor. What each test actually exercises - a workspace, its
// membership rows, RLS on both - is still fully fresh per test; only the
// underlying Auth session is shared. This does not weaken tenant-isolation
// coverage: two workspaces having the same *owner-pool-slot* across two
// unrelated tests proves nothing either way, but within any ONE test that
// needs N pairwise-distinct people (e.g. "workspace A's owner cannot read
// workspace B"), N consecutive cursor draws are guaranteed pairwise
// distinct as long as POOL_SIZE >= N (see below).
//
// Pool identities are never deleted by cleanupTenant() - they're meant to
// persist as fixtures, re-used run after run (idempotent lookup-or-create
// means a second run creates zero new users). Only the WORKSPACES and
// membership rows a test creates are cleaned up.
const POOL_SIZE = 10; // >= the largest number of simultaneously-distinct identities any single test file needs (role-escalation.test.ts uses 6)
const POOL_PASSWORD = "Stabiflow-Test-Pool-Fixture-2026!";

function poolEmail(i: number): string {
  return `stabiflow-test-pool-${i}@stabiflow-test.local`;
}

type PooledIdentity = { userId: string; email: string; client: SupabaseClient };

let poolPromise: Promise<PooledIdentity[]> | null = null;
let poolCursor = 0;

async function ensurePool(): Promise<PooledIdentity[]> {
  if (!poolPromise) {
    poolPromise = (async () => {
      // One listUsers call resolves ids for whichever pool emails already
      // exist from a prior run, instead of N lookups or blindly trying to
      // create and parsing "already registered" errors.
      const { data: existing, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw new Error(`Failed to list existing users while building the test identity pool: ${listError.message}`);
      const byEmail = new Map((existing?.users ?? []).map((u) => [u.email, u.id]));

      const identities: PooledIdentity[] = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        const email = poolEmail(i);
        let userId = byEmail.get(email);
        if (!userId) {
          const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: POOL_PASSWORD, email_confirm: true });
          if (createError || !created.user) throw new Error(`Failed to create pooled test identity ${email}: ${createError?.message}`);
          userId = created.user.id;
        }
        const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
        const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password: POOL_PASSWORD });
        if (signInError || !signIn.session) throw new Error(`Failed to sign in pooled test identity ${email}: ${signInError?.message}`);
        identities.push({ userId, email, client });
      }
      return identities;
    })();
  }
  return poolPromise;
}

async function acquirePooledIdentity(): Promise<PooledIdentity> {
  const pool = await ensurePool();
  const identity = pool[poolCursor % pool.length];
  poolCursor++;
  return identity;
}

export type TestTenant = { userId: string; email: string; client: SupabaseClient; workspaceId: string };

/** Hands out a pooled identity (see above) and has it create a brand-new workspace - it becomes that workspace's owner. The identity itself is shared/reusable; the workspace is always fresh. */
export async function createTestTenant(label: string): Promise<TestTenant> {
  const identity = await acquirePooledIdentity();

  const { data: workspaceId, error: workspaceError } = await identity.client.rpc("create_workspace", {
    p_name: `RLS Test Workspace ${label}`,
    p_slug: `rls-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  if (workspaceError || !workspaceId) throw new Error(`Failed to create workspace for ${label}: ${workspaceError?.message}`);

  return { userId: identity.userId, email: identity.email, client: identity.client, workspaceId: workspaceId as string };
}

/** Hands out a pooled identity with NO workspace of their own - a blank slate to be seeded into someone else's workspace, or to prove they can't self-serve one. */
export async function createTestUser(label: string): Promise<{ userId: string; email: string; client: SupabaseClient }> {
  void label; // kept for call-site readability/labeling at the call site, no longer used to derive an email
  const identity = await acquirePooledIdentity();
  return { userId: identity.userId, email: identity.email, client: identity.client };
}

/** Seeds a workspace_members row directly via the service role (bypasses RLS) - used to place a test user at a specific role without going through the invitation flow, so escalation tests start from a known role. */
export async function seedMembership(workspaceId: string, userId: string, role: string) {
  const { error } = await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role });
  if (error) throw new Error(`Failed to seed membership: ${error.message}`);
}

/** Deletes the WORKSPACE (and, via cascade, every membership/resource row scoped to it) a test created - never the underlying identity, which is a shared pool fixture reused by other tests/runs. A tenant with no workspaceId (a plain createTestUser() result) is a no-op: it owns nothing to clean up, and any membership it was seeded into elsewhere is cleaned up when THAT workspace is deleted. */
export async function cleanupTenant(tenant: { userId: string; workspaceId?: string }) {
  if (tenant.workspaceId) await admin.from("workspaces").delete().eq("id", tenant.workspaceId);
}
