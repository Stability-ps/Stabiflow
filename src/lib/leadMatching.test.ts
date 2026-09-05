import { describe, expect, it } from "vitest";
import { findDuplicateCandidates, type LeadMatchCandidate } from "./leadMatching";

const leads: LeadMatchCandidate[] = [
  { id: "l1", phoneNormalized: "+27831234567", createdFromConversationId: "c1" },
  { id: "l2", phoneNormalized: "+27829998877", createdFromConversationId: null },
  { id: "l3", phoneNormalized: null, createdFromConversationId: "c3" },
];

describe("findDuplicateCandidates", () => {
  it("matches on normalized phone", () => {
    expect(findDuplicateCandidates(leads, { phoneNormalized: "+27831234567" }).map((l) => l.id)).toEqual(["l1"]);
  });

  it("matches on the same linked conversation even with no phone match", () => {
    expect(findDuplicateCandidates(leads, { conversationId: "c3" }).map((l) => l.id)).toEqual(["l3"]);
  });

  it("returns no candidates when neither phone nor conversation is provided", () => {
    expect(findDuplicateCandidates(leads, {})).toEqual([]);
  });

  it("returns no candidates when nothing matches", () => {
    expect(findDuplicateCandidates(leads, { phoneNormalized: "+10000000000", conversationId: "c-unknown" })).toEqual([]);
  });

  it("deduplicates a lead that matches on both phone and conversation", () => {
    const dual: LeadMatchCandidate[] = [{ id: "l4", phoneNormalized: "+27831234567", createdFromConversationId: "c4" }];
    const result = findDuplicateCandidates(dual, { phoneNormalized: "+27831234567", conversationId: "c4" });
    expect(result).toHaveLength(1);
  });

  it("never matches a null phone_normalized against a null query phone", () => {
    // A lead with no known phone must not spuriously "match" another
    // lookup that also has no phone - two unknowns are not equal.
    expect(findDuplicateCandidates(leads, { phoneNormalized: null, conversationId: "c-unrelated" })).toEqual([]);
  });
});
