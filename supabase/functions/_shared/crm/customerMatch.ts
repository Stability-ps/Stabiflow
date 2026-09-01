// Phase 4 - deterministic customer identity matching. The PURE statement
// of the rule the public.customer_match_candidates RPC implements in SQL
// (same pattern as _shared/inbox/leadContext.ts <-> leads-actions, and
// src/lib/leadMatching.ts <-> the duplicate-check query). NEVER an
// auto-merge: callers always get candidates back for a human to decide -
// the one exception is the single-unambiguous-exact-phone auto-link in
// whatsapp-webhook, which this module also expresses.
//
// Evidence tiers, in strict order of strength:
//   EXACT    - normalised phone equal
//            - exact lowercased email equal
//            - the conversation's own lead is already attached to this customer
//   POSSIBLE - same non-empty company name AND same contact name (case-insensitive)
//   NEW      - no defensible match
// No fuzzy strings, no similarity scoring.

export type MatchConversation = {
  phoneNormalized: string | null;
  email: string | null;
  companyName: string | null;
  contactName: string | null;
  leadId: string | null;
};

export type MatchCustomer = {
  id: string;
  phoneNormalized: string | null;
  email: string | null;
  companyName: string | null;
  name: string | null;
  leadId: string | null;
};

export type MatchTier = "exact" | "possible";

export type CustomerCandidate = {
  customerId: string;
  tier: MatchTier;
  reason: string;
};

export type MatchResult = {
  /** "new" when there is no candidate at all. */
  tier: "exact" | "possible" | "new";
  candidates: CustomerCandidate[];
  /** The single customer id to auto-link, or null. Set ONLY when exactly
   * one candidate exists, it is EXACT, and that exact evidence is a phone
   * match (the most collision-resistant signal). Ambiguity => null. */
  autoLinkCustomerId: string | null;
};

const norm = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim().toLowerCase();
  return t.length ? t : null;
};

function evaluate(conv: MatchConversation, cust: MatchCustomer): { tier: MatchTier; reason: string; phoneExact: boolean } | null {
  if (conv.phoneNormalized && cust.phoneNormalized && conv.phoneNormalized === cust.phoneNormalized) {
    return { tier: "exact", reason: `Exact match - phone ${cust.phoneNormalized}`, phoneExact: true };
  }
  const convEmail = norm(conv.email);
  const custEmail = norm(cust.email);
  if (convEmail && custEmail && convEmail === custEmail) {
    return { tier: "exact", reason: `Exact match - email ${cust.email}`, phoneExact: false };
  }
  if (conv.leadId && cust.leadId && conv.leadId === cust.leadId) {
    return { tier: "exact", reason: "Exact match - this conversation's lead is already this customer", phoneExact: false };
  }
  const convCo = norm(conv.companyName);
  const custCo = norm(cust.companyName);
  const convName = norm(conv.contactName);
  const custName = norm(cust.name);
  if (convCo && custCo && convCo === custCo && convName && custName && convName === custName) {
    return { tier: "possible", reason: "Possible match - same company and contact name", phoneExact: false };
  }
  return null;
}

export function classifyCustomerMatch(conv: MatchConversation, customers: MatchCustomer[]): MatchResult {
  const candidates: CustomerCandidate[] = [];
  let exactPhoneIds: string[] = [];

  for (const cust of customers) {
    const hit = evaluate(conv, cust);
    if (!hit) continue;
    candidates.push({ customerId: cust.id, tier: hit.tier, reason: hit.reason });
    if (hit.phoneExact) exactPhoneIds.push(cust.id);
  }

  // exact candidates first, then possible; stable within a tier.
  candidates.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "exact" ? -1 : 1));

  const tier: MatchResult["tier"] = candidates.length === 0
    ? "new"
    : candidates.some((c) => c.tier === "exact") ? "exact" : "possible";

  // Auto-link only on a single, unambiguous exact PHONE match.
  const uniqueExactPhone = Array.from(new Set(exactPhoneIds));
  const autoLinkCustomerId = uniqueExactPhone.length === 1 ? uniqueExactPhone[0] : null;

  return { tier, candidates, autoLinkCustomerId };
}
