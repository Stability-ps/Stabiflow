import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aiMayReply, handoverState } from "./handoverState.ts";
import { matchesHandoffKeyword, requestsHumanHandoff } from "./replyGuardrails.ts";

Deno.test("handover states derive from the existing columns", () => {
  assertEquals(handoverState({ status: "active", ai_enabled: true, inbox_status: "new" }), "bot_active");
  assertEquals(handoverState({ status: "human_handoff", ai_enabled: false, assigned_staff_id: null, inbox_status: "unassigned" }), "handover_requested");
  assertEquals(handoverState({ status: "human_handoff", ai_enabled: false, assigned_staff_id: "u1", inbox_status: "assigned" }), "human_active");
  assertEquals(handoverState({ status: "active", ai_enabled: false, inbox_status: "new" }), "bot_paused");
  assertEquals(handoverState({ status: "human_handoff", ai_enabled: false, assigned_staff_id: "u1", inbox_status: "resolved" }), "closed");
});

Deno.test("AI may only reply in bot_active", () => {
  assertEquals(aiMayReply({ status: "active", ai_enabled: true }), true);
  for (const c of [
    { status: "human_handoff", ai_enabled: false, assigned_staff_id: "u1" },
    { status: "human_handoff", ai_enabled: false },
    { status: "active", ai_enabled: false },
    { status: "active", ai_enabled: true, inbox_status: "resolved" },
    // defensive: a stale ai_enabled=true must not let AI talk over a human
    { status: "human_handoff", ai_enabled: true, assigned_staff_id: "u1" },
  ]) assertEquals(aiMayReply(c), false, JSON.stringify(c));
});

Deno.test("built-in detection covers the brief's phrases and Acapolite's list", () => {
  for (const t of ["Can I speak to a human?", "I want a person please", "connect me to an agent", "I need a consultant", "please call me", "Call me back", "ngifuna ukukhuluma nomuntu"]) {
    assertEquals(requestsHumanHandoff(t), true, t);
  }
  for (const t of ["What are your prices?", "The agenda for tomorrow", "Thanks, that helps"]) {
    assertEquals(requestsHumanHandoff(t), false, t);
  }
});

Deno.test("workspace keywords match whole phrases only", () => {
  const k = ["refund", "speak to Sipho", "complaint"];
  assertEquals(matchesHandoffKeyword("I want a REFUND now", k), true);
  assertEquals(matchesHandoffKeyword("can I speak to sipho?", k), true);
  assertEquals(matchesHandoffKeyword("refunds policy", k), false);
  assertEquals(matchesHandoffKeyword("anything", []), false);
  assertEquals(matchesHandoffKeyword("anything", null), false);
  assertEquals(matchesHandoffKeyword("a.b", ["a.b", 5, null]), true);
  assertEquals(matchesHandoffKeyword("axb", ["a.b"]), false);
});
