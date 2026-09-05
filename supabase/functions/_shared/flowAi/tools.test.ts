import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FLOW_AI_TOOLS, ToolArgumentError, dispatchTool, isKnownTool } from "./tools.ts";

function fakeClient(recordCalls: { fn: string; params: Record<string, unknown> }[]) {
  return {
    rpc: (fn: string, params: Record<string, unknown>) => {
      recordCalls.push({ fn, params });
      return Promise.resolve({ data: [{ ok: true }], error: null });
    },
  };
}

Deno.test("isKnownTool recognizes every declared tool and rejects an unknown name", () => {
  for (const tool of FLOW_AI_TOOLS) assertEquals(isKnownTool(tool.name), true);
  assertEquals(isKnownTool("delete_everything"), false);
  assertEquals(isKnownTool("update_campaign_budget"), false);
});

Deno.test("every declared tool's JSON schema has no workspace_id property - the model has no slot for it", () => {
  for (const tool of FLOW_AI_TOOLS) {
    const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    assertEquals("workspace_id" in properties, false, `${tool.name} must not declare a workspace_id parameter`);
  }
});

Deno.test("dispatchTool always uses the workspaceId ARGUMENT, never one hidden inside the model-supplied args", async () => {
  const calls: { fn: string; params: Record<string, unknown> }[] = [];
  const client = fakeClient(calls);
  // A malicious/confused model tries to smuggle a different workspace_id inside args.
  await dispatchTool(client, "real-workspace-id", "list_leads", { status: "active", workspace_id: "attacker-workspace-id" } as never);
  assertEquals(calls[0].params.p_workspace_id, "real-workspace-id");
});

Deno.test("dispatchTool maps list_leads to ai_list_leads with the expected parameter names", async () => {
  const calls: { fn: string; params: Record<string, unknown> }[] = [];
  const client = fakeClient(calls);
  await dispatchTool(client, "ws-1", "list_leads", { status: "qualified", date_from: "2026-01-01", date_to: "2026-02-01", limit: 10 });
  assertEquals(calls[0].fn, "ai_list_leads");
  assertEquals(calls[0].params, { p_workspace_id: "ws-1", p_status: "qualified", p_qualification_status: null, p_date_from: "2026-01-01", p_date_to: "2026-02-01", p_limit: 10 });
});

Deno.test("dispatchTool maps get_campaign_performance to the existing Phase H RPC, defaulting attribution_model to last_touch", async () => {
  const calls: { fn: string; params: Record<string, unknown> }[] = [];
  const client = fakeClient(calls);
  await dispatchTool(client, "ws-1", "get_campaign_performance", { date_from: "2026-01-01", date_to: "2026-02-01" });
  assertEquals(calls[0].fn, "get_campaign_performance");
  assertEquals(calls[0].params.p_attribution_model, "last_touch");
});

Deno.test("dispatchTool rejects get_touch_summary with a missing target_id", async () => {
  const client = fakeClient([]);
  await assertRejects(() => dispatchTool(client, "ws-1", "get_touch_summary", { target_type: "lead" } as never), ToolArgumentError);
});

Deno.test("dispatchTool rejects get_analytics_kpis with a missing date range", async () => {
  const client = fakeClient([]);
  await assertRejects(() => dispatchTool(client, "ws-1", "get_analytics_kpis", {} as never), ToolArgumentError);
});

Deno.test("dispatchTool rejects an unknown tool name", async () => {
  const client = fakeClient([]);
  await assertRejects(() => dispatchTool(client, "ws-1", "not_a_real_tool", {}), ToolArgumentError);
});

Deno.test("dispatchTool surfaces the underlying RPC error rather than swallowing it", async () => {
  const client = { rpc: () => Promise.resolve({ data: null, error: { message: "permission denied" } }) };
  await assertRejects(() => dispatchTool(client, "ws-1", "list_campaigns", {}), Error, "permission denied");
});
