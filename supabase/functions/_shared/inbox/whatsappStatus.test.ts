import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyStatusUpdate, formatStatusFailureDetail, incomingStatuses, shouldApplyStatus, type StatusDbClient } from "./whatsappStatus.ts";

function statusPayload(statuses: unknown[]) {
  return { entry: [{ changes: [{ value: { statuses } }] }] };
}

type FakeMessageRow = { id: string; conversation_id: string; delivery_status: string | null; workspace_id?: string };

// A minimal stand-in for the Supabase client used only by applyStatusUpdate:
// `.from("inbox_messages").select(...).eq(...).maybeSingle()`,
// `.from("inbox_messages").update(...).eq(...)`, and
// `.from("inbox_alerts").insert(...)`. Records every call so tests can
// assert exactly what did (and did not) happen, without touching a real DB.
function fakeClient(options: {
  message: FakeMessageRow | null;
  lookupError?: { message: string } | null;
  updateError?: { message: string } | null;
  insertError?: { code?: string; message: string } | null;
}) {
  const calls: { table: string; op: "select" | "update" | "insert"; arg?: unknown }[] = [];
  const client: StatusDbClient = {
    from(table: string) {
      if (table === "inbox_messages") {
        return {
          select() {
            calls.push({ table, op: "select" });
            return {
              eq() {
                return {
                  maybeSingle: () => Promise.resolve({ data: options.message, error: options.lookupError ?? null }),
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            calls.push({ table, op: "update", arg: patch });
            return { eq: () => Promise.resolve({ error: options.updateError ?? null }) };
          },
        };
      }
      if (table === "inbox_alerts") {
        return {
          insert(row: Record<string, unknown>) {
            calls.push({ table, op: "insert", arg: row });
            return Promise.resolve({ error: options.insertError ?? null });
          },
        };
      }
      throw new Error(`fakeClient: unexpected table ${table}`);
    },
  };
  return { client, calls };
}

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";

Deno.test("incomingStatuses extracts delivered/read/failed events with their message id", () => {
  const payload = statusPayload([
    { id: "wamid.DELIVERED", status: "delivered", timestamp: "1" },
    { id: "wamid.READ", status: "READ", timestamp: "2" },
    { id: "wamid.FAILED", status: "failed", timestamp: "3", errors: [{ code: 131047, title: "Re-engagement message" }] },
  ]);

  const events = incomingStatuses(payload);

  assertEquals(events.length, 3);
  assertEquals(events[0], { metaMessageId: "wamid.DELIVERED", status: "delivered", errors: [] });
  assertEquals(events[1].status, "read");
  assertEquals(events[2].errors[0].code, 131047);
});

Deno.test("incomingStatuses ignores entries missing an id or a status", () => {
  const payload = statusPayload([
    { status: "delivered" },
    { id: "wamid.NOSTATUS" },
    { id: "", status: "delivered" },
  ]);

  assertEquals(incomingStatuses(payload).length, 0);
});

Deno.test("incomingStatuses tolerates a malformed payload shape without throwing", () => {
  assertEquals(incomingStatuses(null), []);
  assertEquals(incomingStatuses({}), []);
  assertEquals(incomingStatuses({ entry: "not-an-array" }), []);
  assertEquals(incomingStatuses({ entry: [{ changes: [{ value: { statuses: "not-an-array" } }] }] }), []);
});

Deno.test("shouldApplyStatus moves forward through sent -> delivered -> read", () => {
  assertEquals(shouldApplyStatus(null, "sent"), true);
  assertEquals(shouldApplyStatus("submitted", "sent"), true);
  assertEquals(shouldApplyStatus("sent", "delivered"), true);
  assertEquals(shouldApplyStatus("delivered", "read"), true);
});

Deno.test("shouldApplyStatus rejects a late/duplicate status that would regress the UI", () => {
  assertEquals(shouldApplyStatus("read", "delivered"), false);
  assertEquals(shouldApplyStatus("delivered", "sent"), false);
  assertEquals(shouldApplyStatus("read", "sent"), false);
});

Deno.test("shouldApplyStatus treats an identical repeated status as a safe no-op apply", () => {
  assertEquals(shouldApplyStatus("delivered", "delivered"), true);
});

Deno.test("shouldApplyStatus always records a failed status except once already failed", () => {
  assertEquals(shouldApplyStatus("sent", "failed"), true);
  assertEquals(shouldApplyStatus("delivered", "failed"), true);
  assertEquals(shouldApplyStatus("failed", "failed"), false);
  assertEquals(shouldApplyStatus("failed", "delivered"), false);
  assertEquals(shouldApplyStatus("failed", "read"), false);
});

Deno.test("formatStatusFailureDetail builds a short, useful message from Meta's error shape", () => {
  const detail = formatStatusFailureDetail([
    { code: 131047, title: "Re-engagement message", message: "Message failed to send because more than 24 hours have passed", error_data: { details: "outside customer service window" } },
  ]);
  assertEquals(detail.includes("131047"), true);
  assertEquals(detail.includes("Re-engagement message"), true);
  assertEquals(detail.includes("outside customer service window"), true);
});

Deno.test("formatStatusFailureDetail never dumps a raw payload and stays short when Meta gives no detail", () => {
  assertEquals(formatStatusFailureDetail([]), "");
  const detail = formatStatusFailureDetail([{}]);
  assertEquals(detail, "WhatsApp reported this message as failed: WhatsApp did not provide further detail.");
});

Deno.test("applyStatusUpdate marks a matching message delivered", async () => {
  const { client, calls } = fakeClient({ message: { id: "msg-1", conversation_id: "conv-1", delivery_status: "sent" } });
  await applyStatusUpdate(client, { metaMessageId: "wamid.1", status: "delivered", errors: [] });

  const update = calls.find((c) => c.op === "update");
  assertExists(update);
  assertEquals(update?.arg, { delivery_status: "delivered" });
  assertEquals(calls.some((c) => c.op === "insert"), false);
});

Deno.test("applyStatusUpdate marks a matching message read", async () => {
  const { client, calls } = fakeClient({ message: { id: "msg-1", conversation_id: "conv-1", delivery_status: "delivered" } });
  await applyStatusUpdate(client, { metaMessageId: "wamid.1", status: "read", errors: [] });

  assertEquals(calls.find((c) => c.op === "update")?.arg, { delivery_status: "read" });
});

Deno.test("applyStatusUpdate records a failed status with a useful, short error detail, tagged with the message's own workspace", async () => {
  const { client, calls } = fakeClient({ message: { id: "msg-1", conversation_id: "conv-1", delivery_status: "sent", workspace_id: WORKSPACE_ID } });
  await applyStatusUpdate(client, {
    metaMessageId: "wamid.1",
    status: "failed",
    errors: [{ code: 131047, title: "Re-engagement message", message: "Message failed to send" }],
  });

  const insert = calls.find((c) => c.op === "insert");
  assertExists(insert);
  const row = insert?.arg as Record<string, unknown>;
  assertEquals(row.workspace_id, WORKSPACE_ID);
  assertEquals(row.alert_type, "message_failed");
  assertEquals(row.message_id, "msg-1");
  assertEquals(row.conversation_id, "conv-1");
  assertEquals(typeof row.body === "string" && (row.body as string).includes("131047"), true);
  assertEquals(calls.find((c) => c.op === "update")?.arg, { delivery_status: "failed" });
});

Deno.test("applyStatusUpdate is safe to call again for the exact same (duplicate) failed callback", async () => {
  // second call sees the message already marked failed from the first callback
  const { client, calls } = fakeClient({ message: { id: "msg-1", conversation_id: "conv-1", delivery_status: "failed" } });
  await applyStatusUpdate(client, {
    metaMessageId: "wamid.1",
    status: "failed",
    errors: [{ code: 131047, title: "Re-engagement message" }],
  });

  // shouldApplyStatus rejects failed -> failed, so nothing further happens - no second alert, no redundant update
  assertEquals(calls.some((c) => c.op === "insert"), false);
  assertEquals(calls.some((c) => c.op === "update"), false);
});

Deno.test("applyStatusUpdate ignores a status for a provider_message_id StabiFlow never sent", async () => {
  const { client, calls } = fakeClient({ message: null });
  await applyStatusUpdate(client, { metaMessageId: "wamid.unknown", status: "delivered", errors: [] });

  assertEquals(calls.some((c) => c.op === "update"), false);
  assertEquals(calls.some((c) => c.op === "insert"), false);
});

Deno.test("applyStatusUpdate ignores an untracked status without querying the database", async () => {
  const { client, calls } = fakeClient({ message: { id: "msg-1", conversation_id: "conv-1", delivery_status: "sent" } });
  await applyStatusUpdate(client, { metaMessageId: "wamid.1", status: "deleted", errors: [] });

  assertEquals(calls.length, 0);
});

Deno.test("applyStatusUpdate does not throw when the message lookup itself errors", async () => {
  const { client, calls } = fakeClient({ message: null, lookupError: { message: "connection reset" } });
  await applyStatusUpdate(client, { metaMessageId: "wamid.1", status: "delivered", errors: [] });

  assertEquals(calls.some((c) => c.op === "update"), false);
});
