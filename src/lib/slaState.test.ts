import { describe, it, expect } from "vitest";
import { computeSlaState, type SlaConversation } from "./slaState.ts";

const S = { handoff_sla_minutes: 10, handoff_sla_enabled: true };
const NOW = Date.parse("2026-09-01T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("computeSlaState (frontend mirror)", () => {

  const handoff = (o: Partial<SlaConversation> = {}): SlaConversation => ({
    status: "human_handoff", ai_enabled: false, inbox_status: "assigned",
    human_handoff_requested_at: ago(3), last_staff_reply_at: null, ...o,
  });

  it("waiting: handoff 3 min ago, 10 min SLA -> waiting, 7 remaining", () => {
    const st = computeSlaState(handoff({ human_handoff_requested_at: ago(3) }), S, NOW);
    expect(st.applicable).toBe(true);
    expect(st.phase).toBe("waiting");
    expect(st.minutesRemaining).toBe(7);
    expect(st.minutesOverdue).toBe(0);
  });

  it("due_soon: within the 20% window", () => {
    const st = computeSlaState(handoff({ human_handoff_requested_at: ago(9) }), S, NOW);
    expect(st.phase).toBe("due_soon");
    expect(st.minutesRemaining).toBe(1);
  });

  it("overdue: handoff 14 min ago -> overdue by 4", () => {
    const st = computeSlaState(handoff({ human_handoff_requested_at: ago(14) }), S, NOW);
    expect(st.phase).toBe("overdue");
    expect(st.minutesOverdue).toBe(4);
    expect(st.minutesRemaining).toBe(-4);
  });

  it("not applicable: AI still enabled", () => {
    expect(computeSlaState(handoff({ ai_enabled: true, human_handoff_requested_at: ago(30) }), S, NOW).applicable).toBe(false);
  });

  it("not applicable: status not human_handoff", () => {
    expect(computeSlaState(handoff({ status: "active", human_handoff_requested_at: ago(30) }), S, NOW).phase).toBe("not_applicable");
  });

  it("not applicable: conversation resolved", () => {
    expect(computeSlaState(handoff({ inbox_status: "resolved", human_handoff_requested_at: ago(30) }), S, NOW).applicable).toBe(false);
  });

  it("not applicable: SLA disabled for the workspace", () => {
    expect(computeSlaState(handoff({ human_handoff_requested_at: ago(30) }), { handoff_sla_minutes: 10, handoff_sla_enabled: false }, NOW).applicable).toBe(false);
  });

  it("responded: a staff reply after handoff stops the clock", () => {
    const st = computeSlaState(handoff({ human_handoff_requested_at: ago(30), last_staff_reply_at: ago(20) }), S, NOW);
    expect(st.responded).toBe(true);
    expect(st.applicable).toBe(false);
    expect(st.phase).toBe("not_applicable");
  });

  it("NOT responded: last staff reply predates this handoff episode", () => {
    const st = computeSlaState(handoff({ human_handoff_requested_at: ago(14), last_staff_reply_at: ago(120) }), S, NOW);
    expect(st.responded).toBe(false);
    expect(st.phase).toBe("overdue");
  });

  it("assignment alone does not stop the clock", () => {
    const st = computeSlaState(handoff({ human_handoff_requested_at: ago(20), assigned_staff_id: "u1", assigned_staff_name: "Sam" }), S, NOW);
    expect(st.phase).toBe("overdue");
    expect(st.minutesOverdue).toBe(10);
  });

  it("per-workspace threshold: 30 min SLA -> same 20-min wait is still waiting", () => {
    const st = computeSlaState(handoff({ human_handoff_requested_at: ago(20) }), { handoff_sla_minutes: 30, handoff_sla_enabled: true }, NOW);
    expect(st.phase).toBe("waiting");
    expect(st.minutesRemaining).toBe(10);
  });

});
