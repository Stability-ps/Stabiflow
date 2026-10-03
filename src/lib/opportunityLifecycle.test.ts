import { describe, expect, it } from "vitest";
import { canTransitionOpportunityStatus, opportunityStatusLabel } from "./opportunityLifecycle";

describe("canTransitionOpportunityStatus", () => {
  it("allows open -> won and open -> lost", () => {
    expect(canTransitionOpportunityStatus("open", "won")).toBe(true);
    expect(canTransitionOpportunityStatus("open", "lost")).toBe(true);
  });

  it("allows reopening from either terminal state", () => {
    expect(canTransitionOpportunityStatus("won", "open")).toBe(true);
    expect(canTransitionOpportunityStatus("lost", "open")).toBe(true);
  });

  it("rejects a direct won <-> lost transition - must reopen first", () => {
    expect(canTransitionOpportunityStatus("won", "lost")).toBe(false);
    expect(canTransitionOpportunityStatus("lost", "won")).toBe(false);
  });

  it("rejects a no-op transition to the same status", () => {
    expect(canTransitionOpportunityStatus("open", "open")).toBe(false);
    expect(canTransitionOpportunityStatus("won", "won")).toBe(false);
  });
});

describe("opportunityStatusLabel", () => {
  it("labels every status", () => {
    expect(opportunityStatusLabel("open")).toBe("Open");
    expect(opportunityStatusLabel("won")).toBe("Won");
    expect(opportunityStatusLabel("lost")).toBe("Lost");
  });
});
