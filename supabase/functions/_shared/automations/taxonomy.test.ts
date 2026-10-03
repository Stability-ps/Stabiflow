import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { EVENT_TYPES, ACTION_TYPES, isEventType, isActionType, isConditionOperator } from "./taxonomy.ts";

Deno.test("isEventType accepts every declared event and rejects an arbitrary tenant-supplied name", () => {
  for (const type of EVENT_TYPES) assertEquals(isEventType(type), true);
  assertEquals(isEventType("delete_workspace"), false);
  assertEquals(isEventType("lead.created; DROP TABLE leads;"), false);
});

Deno.test("isActionType accepts every declared action and rejects anything outside the registry (no arbitrary SQL/shell/HTTP)", () => {
  for (const type of ACTION_TYPES) assertEquals(isActionType(type), true);
  assertEquals(isActionType("execute_sql"), false);
  assertEquals(isActionType("send_whatsapp_message"), false);
  assertEquals(isActionType("increase_campaign_budget"), false);
});

Deno.test("isConditionOperator rejects an unrecognized operator", () => {
  assertEquals(isConditionOperator("eq"), true);
  assertEquals(isConditionOperator("$where"), false);
});
