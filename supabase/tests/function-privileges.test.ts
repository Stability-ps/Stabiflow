// Database function hardening (20261006133335_harden_function_privileges).
//
// Proves, against LOCAL Supabase with REAL grants:
//   * an anonymous caller (public API key, no session) can no longer reach
//     SECURITY DEFINER functions that need a signed-in member
//   * a signed-in member still can, and still only sees their own workspace
//   * next_lead_reference() is unreachable by any client role, yet a member
//     inserting a lead still gets a LEAD-xxxxxx reference (trigger path)
//   * the public profile / legal-version functions stay anon-callable
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, cleanupTenant, createTestTenant, SUPABASE_URL, enableModules, type TestTenant } from "./helpers";

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const range = { p_date_from: "2026-01-01T00:00:00Z", p_date_to: "2027-01-01T00:00:00Z" };

let owner: TestTenant;
let other: TestTenant;

beforeAll(async () => {
  owner = await createTestTenant("fn-priv-owner");
  await enableModules(owner.workspaceId, "module.leads");
  other = await createTestTenant("fn-priv-other");
  await enableModules(other.workspaceId, "module.leads");
});

afterAll(async () => {
  await cleanupTenant(owner);
  await cleanupTenant(other);
});

describe("member-only SECURITY DEFINER functions", () => {
  it("reject an anonymous caller with a permission error", async () => {
    const kpis = await anon.rpc("get_analytics_kpis", { p_workspace_id: owner.workspaceId, ...range });
    expect(kpis.error?.message).toMatch(/permission denied/i);

    const search = await anon.rpc("customers_search", { p_workspace_id: owner.workspaceId, p_query: "a", p_limit: 5 });
    expect(search.error?.message).toMatch(/permission denied/i);
  });

  it("still work for a signed-in member of the workspace", async () => {
    const { data, error } = await owner.client.rpc("get_analytics_kpis", { p_workspace_id: owner.workspaceId, ...range });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("still return nothing for another workspace's id", async () => {
    const { data, error } = await owner.client.rpc("get_lead_source_breakdown", { p_workspace_id: other.workspaceId, ...range });
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

describe("next_lead_reference()", () => {
  it("is not callable by anon or by a signed-in member", async () => {
    const asAnon = await anon.rpc("next_lead_reference", { p_workspace_id: owner.workspaceId });
    expect(asAnon.error?.message).toMatch(/permission denied/i);
    const asMember = await owner.client.rpc("next_lead_reference", { p_workspace_id: other.workspaceId });
    expect(asMember.error?.message).toMatch(/permission denied/i);
  });

  it("still mints a reference when a member inserts a lead", async () => {
    const { data, error } = await owner.client
      .from("leads")
      .insert({ workspace_id: owner.workspaceId, contact_name: "Privilege Test", source: "manual" })
      .select("human_reference")
      .single();
    if (error) throw new Error(error.message);
    expect(data.human_reference).toMatch(/^LEAD-\d+$/);
  });
});

describe("public functions", () => {
  it("stay callable without a session", async () => {
    const legal = await anon.rpc("current_legal_versions");
    expect(legal.error).toBeNull();
    const profile = await anon.rpc("get_public_business_profile", { p_slug: "no-such-profile" });
    expect(profile.error).toBeNull();
  });
});

// 20261026070000: the workspace helper functions are signed-in only. (The
// replayed trigger-function revoke is verified with SQL on a fresh database:
// PostgREST never exposes trigger functions, so an API test cannot tell.)
describe("workspace helper functions are not anon-callable", () => {
  const helpers: [string, Record<string, unknown>][] = [
    ["is_workspace_member", {}],
    ["has_workspace_permission", { p_permission: "lead.view" }],
    ["has_workspace_role", { p_min_role: "viewer" }],
    ["can_grant_workspace_role", { p_new_role: "owner" }],
    ["can_manage_member_with_role", { p_current_role: "viewer" }],
  ];

  for (const [fn, args] of helpers) {
    it(`${fn}: anon gets a permission error, a member still gets an answer`, async () => {
      const asAnon = await anon.rpc(fn, { p_workspace_id: owner.workspaceId, ...args });
      expect(asAnon.error?.message).toMatch(/permission denied/i);
      const asMember = await owner.client.rpc(fn, { p_workspace_id: owner.workspaceId, ...args });
      expect(asMember.error).toBeNull();
    });
  }

  it("anonymous reads of protected tables still return nothing rather than erroring", async () => {
    for (const table of ["workspaces", "workspace_members", "leads", "customers", "inbox_conversations", "workspace_settings", "content_media_assets"]) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      expect(error, `${table} as anon`).toBeNull();
      expect(data ?? [], `${table} as anon`).toEqual([]);
    }
    const { error: storageError } = await anon.storage.from("content-media").list(owner.workspaceId);
    expect(storageError).toBeNull();
  });

  it("a member's own RLS reads still work", async () => {
    const { data, error } = await owner.client.from("workspaces").select("id").eq("id", owner.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});
