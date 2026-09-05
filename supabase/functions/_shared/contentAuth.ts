// Shared request plumbing for the Content module's edge functions.
//
// Replaces a pattern from Acapolite that every one of its social-* edge
// functions copy-pasted independently: a hardcoded project URL + anon key
// literal (`MAIN_URL`/`MAIN_PUBLISHABLE_KEY`), and an `authenticateAdmin()`
// that called a single global `get_my_role() = 'admin'` RPC. Both problems
// are fixed here in one place: the URL/key always come from
// SUPABASE_URL/SUPABASE_ANON_KEY (this project's own env, never a literal),
// and authorization is `has_workspace_permission(workspace_id, permission)`
// - a specific permission, checked against a specific workspace, not a
// single global role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const JSON_HEADERS = { "Content-Type": "application/json" };

export function envVar(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Like envVar but returns null instead of throwing when unset - for
 * genuinely optional config (e.g. a verification-only app id). */
export function optionalEnvVar(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value && value.length > 0 ? value : null;
}

export function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), ...JSON_HEADERS, "Cache-Control": "no-store" } });
}

export function bearerToken(req: Request): string {
  return (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
}

// deno-lint-ignore no-explicit-any
export type AnySupabaseClient = any;

// A client that acts AS THE CALLER: every query runs under their JWT, so
// RLS (is_workspace_member/has_workspace_permission-based policies) is the
// real authorization boundary for anything done with this client. This is
// deliberately the DEFAULT for every Content edge function except the cron
// worker - see contentPublishExecution.ts's header comment for the one
// documented exception (resolving a workspace's Meta token, which requires
// service role because EXECUTE on get_workspace_integration_secret is
// revoked from authenticated).
export function createCallerClient(token: string): AnySupabaseClient {
  return createClient(envVar("SUPABASE_URL"), envVar("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// A client that bypasses RLS entirely. Only ever used after the caller's
// own permission has already been verified via createCallerClient() above -
// see each edge function's own comment for exactly what was checked before
// this gets used.
export function createServiceClient(): AnySupabaseClient {
  return createClient(envVar("SUPABASE_URL"), envVar("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getCallerUserId(callerClient: AnySupabaseClient): Promise<string | null> {
  const { data, error } = await callerClient.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id as string;
}

// Runs has_workspace_permission(workspace_id, permission) AS THE CALLER
// (auth.uid() inside the function resolves to whoever's JWT is on
// callerClient) - this is the one permission check every Content edge
// function performs before doing anything permission-gated, and it is not
// satisfiable by role rank alone (a marketing/sales/support member's rank
// is identical, so only the named permission distinguishes them).
export async function hasWorkspacePermission(callerClient: AnySupabaseClient, workspaceId: string, permission: string): Promise<boolean> {
  const { data, error } = await callerClient.rpc("has_workspace_permission", { p_workspace_id: workspaceId, p_permission: permission });
  return !error && data === true;
}

export async function hasWorkspaceRole(callerClient: AnySupabaseClient, workspaceId: string, minRole: string): Promise<boolean> {
  const { data, error } = await callerClient.rpc("has_workspace_role", { p_workspace_id: workspaceId, p_min_role: minRole });
  return !error && data === true;
}
