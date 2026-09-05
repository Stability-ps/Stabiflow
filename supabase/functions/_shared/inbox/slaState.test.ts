import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeSlaState, type SlaConversation } from "./slaState.ts";

const S = { handoff_sla_minutes: 10, handoff_sla_enabled: true };
const NOW = Date.parse("2026-09-01T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const handoff = (o: Partial<SlaConversation> = {}): SlaConversation => ({
  status: "human_handoff", ai_enabled: false, inbox_status: "assigned",
  human_handoff_requested_at: ago(3), last_staff_reply_at: null, ...o,
});

Deno.test("waiting: handoff 3 min ago, 10 min SLA -> waiting, 7 remaining", () => {
  const st = computeSlaState(handoff({ human_handoff_requested_at: ago(3) }), S, NOW);
  assertEquals(st.applicable, true);
  assertEquals(st.phase, "waiting");
  assertEquals(st.minutesRemaining, 7);
  assertEquals(st.minutesOverdue, 0);
});

Deno.test("due_soon: within the 20% window", () => {
  const st = computeSlaState(handoff({ human_handoff_requested_at: ago(9) }), S, NOW);
  assertEquals(st.phase, "due_soon");
  assertEquals(st.minutesRemaining, 1);
});

Deno.test("overdue: handoff 14 min ago -> overdue by 4", () => {
  const st = computeSlaState(handoff({ human_handoff_requested_at: ago(14) }), S, NOW);
  assertEquals(st.phase, "overdue");
  assertEquals(st.minutesOverdue, 4);
  assertEquals(st.minutesRemaining, -4);
});

Deno.test("not applicable: AI still enabled", () => {
  assertEquals(computeSlaState(handoff({ ai_enabled: true, human_handoff_requested_at: ago(30) }), S, NOW).applicable, false);
});

Deno.test("not applicable: status not human_handoff", () => {
  assertEquals(computeSlaState(handoff({ status: "active", human_handoff_requested_at: ago(30) }), S, NOW).phase, "not_applicable");
});

Deno.test("not applicable: conversation resolved", () => {
  assertEquals(computeSlaState(handoff({ inbox_status: "resolved", human_handoff_requested_at: ago(30) }), S, NOW).applicable, false);
});

Deno.test("not applicable: SLA disabled for the workspace", () => {
  assertEquals(computeSlaState(handoff({ human_handoff_requested_at: ago(30) }), { handoff_sla_minutes: 10, handoff_sla_enabled: false }, NOW).applicable, false);
});

Deno.test("responded: a staff reply after handoff stops the clock", () => {
  const st = computeSlaState(handoff({ human_handoff_requested_at: ago(30), last_staff_reply_at: ago(20) }), S, NOW);
  assertEquals(st.responded, true);
  assertEquals(st.applicable, false);
  assertEquals(st.phase, "not_applicable");
});

Deno.test("NOT responded: last staff reply predates this handoff episode", () => {
  const st = computeSlaState(handoff({ human_handoff_requested_at: ago(14), last_staff_reply_at: ago(120) }), S, NOW);
  assertEquals(st.responded, false);
  assertEquals(st.phase, "overdue");
});

Deno.test("assignment alone does not stop the clock", () => {
  const st = computeSlaState(handoff({ human_handoff_requested_at: ago(20), assigned_staff_id: "u1", assigned_staff_name: "Sam" }), S, NOW);
  assertEquals(st.phase, "overdue");
  assertEquals(st.minutesOverdue, 10);
});

Deno.test("per-workspace threshold: 30 min SLA -> same 20-min wait is still waiting", () => {
  const st = computeSlaState(handoff({ human_handoff_requested_at: ago(20) }), { handoff_sla_minutes: 30, handoff_sla_enabled: true }, NOW);
  assertEquals(st.phase, "waiting");
  assertEquals(st.minutesRemaining, 10);
});
