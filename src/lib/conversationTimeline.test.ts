import { describe, expect, it } from "vitest";
import { describeActivity, type ActivityRow } from "@/lib/conversationTimeline";

const row = (action: string, metadata: Record<string, unknown> = {}, actor_name: string | null = "Patric"): ActivityRow =>
  ({ id: "1", action, target_type: "inbox_conversation", target_id: "c", metadata, created_at: "2026-10-06T10:00:00Z", actor_name });

describe("conversation timeline", () => {
  it("tells the handover story in plain language", () => {
    expect(describeActivity(row("inbox_conversation_handoff_requested", { by: "customer" }, null))?.text).toBe("Customer asked for a person");
    expect(describeActivity(row("inbox_conversation_handoff_requested", { by: "ai" }, null))?.text).toBe("AI requested a human handover");
    expect(describeActivity(row("inbox_conversation_taken_over"))?.text).toBe("Patric took over");
    expect(describeActivity(row("inbox_conversation_returned_to_ai", { source: "automation" }))?.text).toBe("Automation returned this chat to AI");
    expect(describeActivity(row("lead_created"))?.tone).toBe("crm");
  });
  it("hides messages (shown as bubbles) and unknown codes", () => {
    expect(describeActivity(row("inbox_staff_reply_sent"))).toBeNull();
    expect(describeActivity(row("something_internal"))).toBeNull();
  });
});
