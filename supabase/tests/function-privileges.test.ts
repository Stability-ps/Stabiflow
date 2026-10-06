// Database function hardening (20261022060000_harden_function_privileges).
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
import { ANON_KEY, cleanupTenant, createTestTenant, SUPABASE_URL, type TestTenant } from "./helpers";

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const range = { p_date_from: "2026-01-01T00:00:00Z", p_date_to: "2027-01-01T00:00:00Z" };

let owner: TestTenant;
let other: TestTenant;

beforeAll(async () => {
  owner = await createTestTenant("fn-priv-owner");
  other = await createTestTenant("fn-priv-other");
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
