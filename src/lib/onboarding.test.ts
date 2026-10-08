import { describe, expect, it } from "vitest";
import { computeOnboardingItems, onboardingProgress, type OnboardingCounts } from "./onboarding";

const ZERO_COUNTS: OnboardingCounts = {
  members: 1,
  metaConnected: false,
  whatsappConnected: false,
  defaultPipeline: false,
  content: 0,
  campaigns: 0,
  conversations: 0,
  leadsOrOpportunities: 0,
  flowAiConversations: 0,
  automations: 0,
  profileComplete: false,
  analyticsVisited: false,
};

describe("computeOnboardingItems", () => {
  it("a brand-new workspace has only the trivial workspace-creation item complete", () => {
    const items = computeOnboardingItems(ZERO_COUNTS);
    const workspaceItem = items.find((i) => i.key === "workspace");
    expect(workspaceItem?.complete).toBe(true);
    expect(items.filter((i) => i.complete)).toHaveLength(1);
  });

  it("members > 1 completes the invite-team item, exactly 1 does not", () => {
    expect(computeOnboardingItems({ ...ZERO_COUNTS, members: 1 }).find((i) => i.key === "team")?.complete).toBe(false);
    expect(computeOnboardingItems({ ...ZERO_COUNTS, members: 2 }).find((i) => i.key === "team")?.complete).toBe(true);
  });

  it("connecting meta and whatsapp independently completes only their own item", () => {
    const metaOnly = computeOnboardingItems({ ...ZERO_COUNTS, metaConnected: true });
    expect(metaOnly.find((i) => i.key === "meta")?.complete).toBe(true);
    expect(metaOnly.find((i) => i.key === "whatsapp")?.complete).toBe(false);
  });

  it("profileComplete drives the company-profile item", () => {
    expect(computeOnboardingItems({ ...ZERO_COUNTS, profileComplete: true }).find((i) => i.key === "profile")?.complete).toBe(true);
  });

  it("a count of 0 leaves the corresponding item incomplete, any positive count completes it", () => {
    expect(computeOnboardingItems({ ...ZERO_COUNTS, campaigns: 0 }).find((i) => i.key === "campaign")?.complete).toBe(false);
    expect(computeOnboardingItems({ ...ZERO_COUNTS, campaigns: 3 }).find((i) => i.key === "campaign")?.complete).toBe(true);
  });

  it("leads OR opportunities either one satisfies the lead item", () => {
    expect(computeOnboardingItems({ ...ZERO_COUNTS, leadsOrOpportunities: 1 }).find((i) => i.key === "lead")?.complete).toBe(true);
  });

  it("every item is fully complete when every signal is present", () => {
    const items = computeOnboardingItems({
      members: 3,
      metaConnected: true,
      whatsappConnected: true,
      defaultPipeline: true,
      content: 1,
      campaigns: 1,
      conversations: 1,
      leadsOrOpportunities: 1,
      flowAiConversations: 1,
      automations: 1,
      profileComplete: true,
      analyticsVisited: true,
    });
    expect(items.every((i) => i.complete)).toBe(true);
  });
});

describe("onboardingProgress", () => {
  it("reports completed/total counts matching the items array", () => {
    const items = computeOnboardingItems(ZERO_COUNTS);
    const progress = onboardingProgress(items);
    expect(progress.total).toBe(items.length);
    expect(progress.completed).toBe(1);
  });
});
