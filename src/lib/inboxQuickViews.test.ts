import { describe, expect, it } from "vitest";
import { EMPTY_INBOX_FILTERS } from "@/hooks/useInboxConversations";
import { activeQuickView, QUICK_VIEWS } from "@/lib/inboxQuickViews";
import { aiMayReply, handoverState } from "@/lib/handoverState";

describe("inbox quick views", () => {
  it("each view round-trips to itself", () => {
    for (const v of QUICK_VIEWS) {
      expect(activeQuickView({ ...EMPTY_INBOX_FILTERS, ...v.patch("me") }, "me")).toBe(v.key);
    }
  });
  it("Mine targets the signed-in member and Needs human means unassigned handover", () => {
    expect(QUICK_VIEWS.find((v) => v.key === "mine")!.patch("u1")).toMatchObject({ assignment: "staff", assignedStaffId: "u1" });
    expect(QUICK_VIEWS.find((v) => v.key === "needs_human")!.patch(null)).toMatchObject({ assignment: "unassigned", handling: "human_attention" });
  });
  it("custom filter combinations are not mistaken for a quick view", () => {
    expect(activeQuickView({ ...EMPTY_INBOX_FILTERS, handling: "human_attention" }, "me")).toBeNull();
  });
});

describe("handover state (shared with the webhook)", () => {
  it("derives the brief's states and only lets AI reply in bot_active", () => {
    expect(handoverState({ status: "human_handoff", ai_enabled: false, assigned_staff_id: null })).toBe("handover_requested");
    expect(handoverState({ status: "human_handoff", ai_enabled: false, assigned_staff_id: "u" })).toBe("human_active");
    expect(aiMayReply({ status: "human_handoff", ai_enabled: false, assigned_staff_id: "u" })).toBe(false);
  });
});
