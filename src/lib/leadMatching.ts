// Pure duplicate-candidate matching rule (durable rule #6): a probable
// existing lead is one that shares a normalized phone number, or is
// already linked to the SAME conversation being acted on. This is the
// spec the leads-actions edge function's duplicate-check SQL query
// implements operationally against real data - kept here as a pure,
// independently-testable statement of the matching rule itself, never an
// auto-merge: callers always get candidates back for a human to decide on.
export type LeadMatchCandidate = {
  id: string;
  phoneNormalized: string | null;
  createdFromConversationId: string | null;
};

export type LeadMatchQuery = {
  phoneNormalized?: string | null;
  conversationId?: string | null;
};

export function findDuplicateCandidates(candidates: LeadMatchCandidate[], query: LeadMatchQuery): LeadMatchCandidate[] {
  const phone = query.phoneNormalized || null;
  const conversationId = query.conversationId || null;
  if (!phone && !conversationId) return [];

  const seen = new Set<string>();
  const matches: LeadMatchCandidate[] = [];
  for (const candidate of candidates) {
    const phoneMatch = !!phone && candidate.phoneNormalized === phone;
    const conversationMatch = !!conversationId && candidate.createdFromConversationId === conversationId;
    if ((phoneMatch || conversationMatch) && !seen.has(candidate.id)) {
      seen.add(candidate.id);
      matches.push(candidate);
    }
  }
  return matches;
}
