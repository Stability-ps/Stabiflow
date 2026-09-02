import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dispatchAction } from "./actionDispatch.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");

function withMockedFetch<T>(handler: (url: string, init: RequestInit | undefined) => Response, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((url: string, init?: RequestInit) => Promise.resolve(handler(url, init))) as any;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function fakeServiceClient(insertedRows: Record<string, unknown>[]) {
  return {
    from: (_table: string) => ({
      insert: (row: Record<string, unknown>) => {
        insertedRows.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  };
}

Deno.test("dispatchAction maps update_lead_stage to leads-actions' move_stage, resolving $event.entity_id", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  await withMockedFetch(
    (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    async () => {
      const result = await dispatchAction({
        actionType: "update_lead_stage",
        actionConfig: { lead_id: "$event.entity_id", pipeline_id: "pipe-1", pipeline_stage_id: "stage-2" },
        event: { entityType: "lead", entityId: "lead-123", payload: {} },
        workspaceId: "ws-1",
        accessToken: "token-abc",
        serviceClient: fakeServiceClient([]),
        actorUserId: "user-1",
      });
      assertEquals(result.status, "succeeded");
    },
  );
  assertEquals(capturedUrl.endsWith("/functions/v1/leads-actions"), true);
  assertEquals(capturedBody, { workspace_id: "ws-1", action: "move_stage", lead_id: "lead-123", pipeline_id: "pipe-1", pipeline_stage_id: "stage-2" });
});

Deno.test("dispatchAction maps assign_lead to leads-actions' assign with target_type=lead", async () => {
  let capturedBody: Record<string, unknown> = {};
  await withMockedFetch(
    (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    async () => {
      await dispatchAction({
        actionType: "assign_lead",
        actionConfig: { staff_id: "staff-1" },
        event: { entityType: "lead", entityId: "lead-999", payload: {} },
        workspaceId: "ws-1",
        accessToken: "token-abc",
        serviceClient: fakeServiceClient([]),
        actorUserId: "user-1",
      });
    },
  );
  assertEquals(capturedBody, { workspace_id: "ws-1", action: "assign", target_type: "lead", target_id: "lead-999", staff_id: "staff-1" });
});

Deno.test("dispatchAction surfaces a dispatcher's error response as a failed result, never throwing", async () => {
  const result = await withMockedFetch(
    () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    () =>
      dispatchAction({
        actionType: "create_opportunity",
        actionConfig: { lead_id: "lead-1", title: "Deal" },
        event: { entityType: "lead", entityId: "lead-1", payload: {} },
        workspaceId: "ws-1",
        accessToken: "token-abc",
        serviceClient: fakeServiceClient([]),
        actorUserId: "user-1",
      }),
  );
  assertEquals(result?.status, "failed");
  assertEquals(result?.error, "Forbidden");
});

Deno.test("dispatchAction's create_notification writes directly to the notifications table (no dispatcher, no permission model beyond membership)", async () => {
  const inserted: Record<string, unknown>[] = [];
  const result = await dispatchAction({
    actionType: "create_notification",
    actionConfig: { title: "Lead needs attention", body: "Untouched for 2 hours" },
    event: { entityType: "lead", entityId: "lead-1", payload: {} },
    workspaceId: "ws-1",
    accessToken: "unused-for-this-action",
    serviceClient: fakeServiceClient(inserted),
    actorUserId: "user-1",
  });
  assertEquals(result.status, "succeeded");
  assertEquals(inserted[0].title, "Lead needs attention");
  assertEquals(inserted[0].user_id, "user-1");
  assertEquals(inserted[0].related_entity_id, "lead-1");
});

// --- Phase 8: WhatsApp automation-parity actions -----------------------

async function runNew(actionType: string, actionConfig: Record<string, unknown>, entityId: string | null, respond: () => Response) {
  let url = "";
  let body: Record<string, unknown> = {};
  const result = await withMockedFetch(
    (u, init) => { url = u; body = JSON.parse((init?.body as string) ?? "{}"); return respond(); },
    () => dispatchAction({
      // deno-lint-ignore no-explicit-any
      actionType: actionType as any,
      actionConfig,
      event: { entityType: "inbox_conversation", entityId, payload: { entity_id: entityId, message_id: "msg-9" } },
      workspaceId: "ws-1",
      accessToken: "tok",
      serviceClient: fakeServiceClient([]),
      actorUserId: "user-1",
      automationContext: { runId: "run-1", automationId: "auto-1", correlationId: "corr-1", depth: 0, actionIndex: 2 },
    }),
  );
  return { url, body, result };
}

Deno.test("set_conversation_priority -> inbox-actions set_priority, conversation from the triggering event, automation context forwarded", async () => {
  const { url, body, result } = await runNew("set_conversation_priority", { priority: "urgent" }, "conv-1", () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  assertEquals(result.status, "succeeded");
  assertEquals(url.endsWith("/functions/v1/inbox-actions"), true);
  assertEquals(body.action, "set_priority");
  assertEquals(body.conversation_id, "conv-1");
  assertEquals(body.priority, "urgent");
  assertEquals((body._automation_context as Record<string, unknown>).actionIndex, 2);
});

Deno.test("set_conversation_handoff -> inbox-actions set_handoff", async () => {
  const { body, result } = await runNew("set_conversation_handoff", {}, "conv-2", () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  assertEquals(result.status, "succeeded");
  assertEquals(body.action, "set_handoff");
  assertEquals(body.conversation_id, "conv-2");
});

Deno.test("send_whatsapp_template parses comma parameters and routes to reply_template", async () => {
  const { body, result } = await runNew("send_whatsapp_template", { template_id: "tpl-1", parameters: "Acme, invoice" }, "conv-3", () => new Response(JSON.stringify({ ok: true, delivery_status: "submitted" }), { status: 200 }));
  assertEquals(result.status, "succeeded");
  assertEquals(body.action, "reply_template");
  assertEquals(body.template_id, "tpl-1");
  assertEquals(body.parameters, ["Acme", "invoice"]);
});

Deno.test("a WhatsApp send with delivery_status 'failed' is a FAILED step, never a green run", async () => {
  const { result } = await runNew("send_whatsapp_template", { template_id: "tpl-1" }, "conv-4", () => new Response(JSON.stringify({ ok: true, delivery_status: "failed", warning: "provider rejected" }), { status: 200 }));
  assertEquals(result.status, "failed");
});

Deno.test("request_document forwards field_key as document_field_key", async () => {
  const { body } = await runNew("request_document", { template_id: "tpl-2", field_key: "proof_of_address" }, "conv-5", () => new Response(JSON.stringify({ ok: true, delivery_status: "submitted" }), { status: 200 }));
  assertEquals(body.action, "request_document");
  assertEquals(body.document_field_key, "proof_of_address");
});

Deno.test("add_tag -> inbox-actions add_tag", async () => {
  const { body, result } = await runNew("add_tag", { tag: "needs-review" }, "conv-6", () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  assertEquals(result.status, "succeeded");
  assertEquals(body.action, "add_tag");
  assertEquals(body.tag, "needs-review");
});

Deno.test("dispatchAction rejects an unknown action_type safely rather than throwing", async () => {
  // deno-lint-ignore no-explicit-any
  const result = await dispatchAction({
    actionType: "delete_workspace" as any,
    actionConfig: {},
    event: { entityType: "lead", entityId: null, payload: {} },
    workspaceId: "ws-1",
    accessToken: "token-abc",
    serviceClient: fakeServiceClient([]),
    actorUserId: "user-1",
  });
  assertEquals(result.status, "failed");
});
