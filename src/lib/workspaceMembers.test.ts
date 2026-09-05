import { describe, expect, it } from "vitest";
import { invitationErrorFromMessage } from "./workspaceMembers";

describe("invitation error presentation", () => {
  it.each([
    ["This invitation was sent to a different email address", "wrong_email", "different account"],
    ["Invitation has expired", "expired", "expired"],
    ["Invitation not found or already used", "unavailable", "accepted or revoked"],
    ["This owner invitation is no longer valid", "unavailable", "new link"],
    ["Must be authenticated to accept an invitation", "unauthenticated", "Sign in"],
  ])("maps %s to a safe state", (raw, reason, copy) => {
    const result = invitationErrorFromMessage(raw);
    expect(result.reason).toBe(reason);
    expect(result.message).toContain(copy);
    expect(result.message).not.toContain("Supabase");
  });

  it("uses a generic safe message for unknown backend errors", () => {
    const result = invitationErrorFromMessage("Edge Function returned a non-2xx status code");
    expect(result.reason).toBe("unknown");
    expect(result.message).not.toContain("Edge Function");
  });
});
