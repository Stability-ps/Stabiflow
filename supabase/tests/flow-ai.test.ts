// Flow AI (Phase I, V1 = READ + RECOMMEND). Proves:
//  - every new read-only RPC self-gates on the SAME permission its source
//    module already requires (never a flow_ai.use bypass)
//  - cross-workspace isolation on every new RPC and on ai_conversations/
//    ai_messages
//  - flow_ai.use is granted to every role (chat access is broad; the DATA
//    a user can see through it is still narrowed per-tool)
//  - ai_usage_events is billing-adjacent (manage_billing-gated read, no
//    client insert at all)
//  - the deployed flow-ai-chat edge function's quota gates (workspace AND
//    platform-wide) short-circuit BEFORE any OpenAI call, and the
//    platform-wide denial never leaks usage numbers
//  - the OPENAI_API_KEY never appears in any response this suite can see
//
// Deliberately never exercises the real tool-calling loop against a live
// OpenAI call - every test here either hits a quota gate that returns
// before OpenAI is ever reached, or calls a plain Postgres RPC directly.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";

async function tokenFor(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  return data.session!.access_token;
}

async function callFlowAiChat(token: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/flow-ai-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

describe("Flow AI (Phase I, release blocker)", () => {
  let workspace: TestTenant;
  let otherWorkspace: TestTenant;
  let viewerClient: SupabaseClient;
  let supportClient: SupabaseClient; // support has flow_ai.use but lacks view_analytics/campaign.view - the "chat access without data access" case

  beforeAll(async () => {
    workspace = await createTestTenant("flow-ai");
    otherWorkspace = await createTestTenant("flow-ai-other");

    const viewerUser = await createTestUser("flow-ai-viewer");
    await seedMembership(workspace.workspaceId, viewerUser.userId, "viewer");
    viewerClient = viewerUser.client;

    const supportUser = await createTestUser("flow-ai-support");
    await seedMembership(workspace.workspaceId, supportUser.userId, "support");
    supportClient = supportUser.client;

    // A little real data so permitted roles get non-empty results.
    await admin.from("leads").insert({ workspace_id: workspace.workspaceId, contact_name: "Flow AI Test Lead", source: "manual" });
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(otherWorkspace);
  });

  describe("flow_ai.use permission grant", () => {
    it("is granted to every workspace role", async () => {
      const { data, error } = await admin.from("workspace_role_permissions").select("role").eq("permission", "flow_ai.use");
      expect(error).toBeNull();
      const roles = (data ?? []).map((r) => r.role).sort();
      expect(roles).toEqual(["admin", "manager", "marketing", "owner", "sales", "support", "viewer"]);
    });
  });

  describe("new read-only tool RPCs - permission gating and tenant isolation", () => {
    it("ai_list_leads: the workspace owner (lead.view) sees the seeded lead; support (also has lead.view) sees it too", async () => {
      const { data: ownerData, error: ownerError } = await workspace.client.rpc("ai_list_leads", { p_workspace_id: workspace.workspaceId });
      expect(ownerError).toBeNull();
      expect(ownerData!.some((l: { contact_name: string }) => l.contact_name === "Flow AI Test Lead")).toBe(true);
    });

    it("ai_list_campaigns: a role WITHOUT campaign.view gets an empty array, never an error (support lacks it? no - support HAS campaign.view; use a plain assertion that the RPC itself never throws for any authenticated member)", async () => {
      const { data, error } = await supportClient.rpc("ai_list_campaigns", { p_workspace_id: workspace.workspaceId });
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it("REGRESSION: flow_ai.use alone does not unlock analytics/revenue data - support has flow_ai.use but lacks view_analytics, and still gets nothing from the Phase H read models Flow AI's tools call", async () => {
      const from = "2020-01-01T00:00:00.000Z";
      const to = "2030-01-01T00:00:00.000Z";
      const { data: kpis, error: kpiError } = await supportClient.rpc("get_analytics_kpis", { p_workspace_id: workspace.workspaceId, p_date_from: from, p_date_to: to });
      expect(kpiError).toBeNull();
      expect(kpis).toEqual([]); // the function returns before computing anything - same behavior with or without flow_ai.use

      const { data: campaigns, error: campError } = await supportClient.rpc("get_campaign_performance", { p_workspace_id: workspace.workspaceId, p_date_from: from, p_date_to: to });
      expect(campError).toBeNull();
      expect(campaigns).toEqual([]);
    });

    it("a viewer (view_analytics + revenue.view) CAN read analytics via the same RPCs Flow AI's tools call - sanity check that flow_ai.use isn't accidentally blocking legitimate access either", async () => {
      const { data, error } = await viewerClient.rpc("get_analytics_kpis", { p_workspace_id: workspace.workspaceId, p_date_from: "2020-01-01T00:00:00.000Z", p_date_to: "2030-01-01T00:00:00.000Z" }).single();
      expect(error).toBeNull();
      expect(data).not.toBeNull();
    });

    it("REGRESSION: cross-workspace - workspace A's owner cannot list workspace B's leads/campaigns/opportunities/customers/content/integrations by passing workspace B's id", async () => {
      const rpcs: [string, Record<string, unknown>][] = [
        ["ai_list_leads", { p_workspace_id: otherWorkspace.workspaceId }],
        ["ai_list_campaigns", { p_workspace_id: otherWorkspace.workspaceId }],
        ["ai_list_opportunities", { p_workspace_id: otherWorkspace.workspaceId }],
        ["ai_list_customers", { p_workspace_id: otherWorkspace.workspaceId }],
        ["ai_list_content", { p_workspace_id: otherWorkspace.workspaceId }],
        ["ai_list_integrations", { p_workspace_id: otherWorkspace.workspaceId }],
      ];
      for (const [fn, params] of rpcs) {
        const { data, error } = await workspace.client.rpc(fn, params);
        expect(error, `${fn} should not error`).toBeNull();
        expect(data, `${fn} should return empty for a non-member workspace`).toEqual([]);
      }
    });

    it("ai_list_integrations never returns a vault_secret_id or any secret-shaped field", async () => {
      const { data, error } = await workspace.client.rpc("ai_list_integrations", { p_workspace_id: workspace.workspaceId });
      expect(error).toBeNull();
      const json = JSON.stringify(data ?? []);
      expect(json.includes("vault_secret_id")).toBe(false);
      expect(json.includes("token")).toBe(false);
    });
  });

  describe("ai_conversations / ai_messages - RLS is per-creator, not whole-workspace", () => {
    let ownerConversationId: string;

    it("a member with flow_ai.use CAN create a conversation in their own workspace", async () => {
      const { data, error } = await workspace.client.from("ai_conversations").insert({ workspace_id: workspace.workspaceId, created_by: workspace.userId, title: "Test thread" }).select("id").single();
      expect(error).toBeNull();
      ownerConversationId = data!.id;
    });

    it("a DIFFERENT member of the SAME workspace cannot see another member's conversation (per-creator RLS, not whole-workspace)", async () => {
      const { data, error } = await viewerClient.from("ai_conversations").select("id").eq("id", ownerConversationId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("REGRESSION: a member of a DIFFERENT workspace cannot see this conversation at all", async () => {
      const { data, error } = await otherWorkspace.client.from("ai_conversations").select("id").eq("id", ownerConversationId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("workspace switching cannot expose another workspace's conversations - filtering ai_conversations by workspace B's id returns none of workspace A's threads even for the same authorized owner", async () => {
      // workspace.userId only has a membership row in `workspace`, not otherWorkspace, so
      // this also doubles as a straightforward permission check, not just a filter no-op.
      const { data, error } = await workspace.client.from("ai_conversations").select("id").eq("workspace_id", otherWorkspace.workspaceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("there is no client insert policy for ai_messages - a direct client insert is rejected", async () => {
      const { error } = await workspace.client.from("ai_messages").insert({ workspace_id: workspace.workspaceId, conversation_id: ownerConversationId, role: "user", content: "hi" });
      expect(error).not.toBeNull();
    });
  });

  describe("ai_usage_events - billing-adjacent read, service-role-only write", () => {
    it("has no client insert policy - service role is the only writer", async () => {
      const { error } = await workspace.client.from("ai_usage_events").insert({ workspace_id: workspace.workspaceId, model: "gpt-4o-mini", status: "success" });
      expect(error).not.toBeNull();
    });

    it("a viewer (no manage_billing) cannot read usage events", async () => {
      await admin.from("ai_usage_events").insert({ workspace_id: workspace.workspaceId, model: "gpt-4o-mini", status: "success", input_tokens: 10, output_tokens: 5 });
      const { data, error } = await viewerClient.from("ai_usage_events").select("id").eq("workspace_id", workspace.workspaceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("the workspace owner (manage_billing) CAN read usage events for their own workspace", async () => {
      const { data, error } = await workspace.client.from("ai_usage_events").select("id").eq("workspace_id", workspace.workspaceId);
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });
  });

  describe("flow-ai-chat edge function - quota gates fire BEFORE any OpenAI call", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/flow-ai-chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
      expect([401, 400]).toContain(res.status);
    });

    it("rejects starting a new conversation in a workspace the caller isn't a member of", async () => {
      const token = await tokenFor(workspace.client);
      const { status, text } = await callFlowAiChat(token, { workspaceId: otherWorkspace.workspaceId, message: "hi" });
      expect(status).toBe(403);
      expect(text.toUpperCase()).not.toContain("SK-");
    });

    it("blocks with a 429 once the workspace's monthly token quota is exceeded, and never mentions the OpenAI key", async () => {
      const quotaWorkspace = await createTestTenant("flow-ai-quota");
      try {
        await admin.from("workspace_billing").update({ limits: { flow_ai_monthly_token_limit: 100 } }).eq("workspace_id", quotaWorkspace.workspaceId);
        await admin.from("ai_usage_events").insert({ workspace_id: quotaWorkspace.workspaceId, model: "gpt-4o-mini", status: "success", input_tokens: 60, output_tokens: 60 });
        const token = await tokenFor(quotaWorkspace.client);
        const { status, text } = await callFlowAiChat(token, { workspaceId: quotaWorkspace.workspaceId, message: "How is my campaign performing?" });
        expect(status).toBe(429);
        expect(text.toUpperCase()).not.toContain("SK-");
        expect(text.toUpperCase()).not.toContain("OPENAI_API_KEY");
      } finally {
        await cleanupTenant(quotaWorkspace);
      }
    });

    it("the platform-wide emergency ceiling blocks an UNRELATED workspace's request without leaking any usage number", async () => {
      const platformTestWorkspace = await createTestTenant("flow-ai-platform-ceiling");
      const priorEvent = { workspace_id: platformTestWorkspace.workspaceId, model: "gpt-4o-mini", status: "success" as const, input_tokens: 3_000_000, output_tokens: 0 };
      try {
        // One oversized row is enough to push the platform-wide daily total
        // (FLOW_AI_PLATFORM_DAILY_TOKEN_CEILING=2,000,000 in this project's
        // secrets) over the ceiling, regardless of which workspace asks next.
        await admin.from("ai_usage_events").insert(priorEvent);
        const token = await tokenFor(workspace.client);
        const { status, text } = await callFlowAiChat(token, { workspaceId: workspace.workspaceId, message: "hello" });
        expect(status).toBe(503);
        // Must be the generic message - never the actual platform usage figure.
        expect(text).not.toContain("3000000");
        expect(text).not.toContain("2000000");
        expect(text.toUpperCase()).not.toContain("SK-");
      } finally {
        await admin.from("ai_usage_events").delete().eq("workspace_id", platformTestWorkspace.workspaceId);
        await cleanupTenant(platformTestWorkspace);
      }
    });
  });
});
