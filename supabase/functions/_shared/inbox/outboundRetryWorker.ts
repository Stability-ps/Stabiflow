// Phase 9 - the retry worker's PURE gate-recheck. Given the CURRENT state
// of a claimed outbound message (workspace status, credential presence,
// messaging-window state, template eligibility), decide whether a fresh
// provider attempt may proceed, or whether the message must be
// dead-lettered/blocked without a send. No I/O - the tick function fetches
// the state and calls this; the integration tests drive the SQL RPCs.

export type RetryGateInput = {
  messageType: string;                 // 'text' | 'template' | ...
  workspaceActive: boolean;            // assertWorkspaceActive().allowed
  hasCredential: boolean;              // resolveCredential() !== null
  windowOpen: boolean;                 // resolveMessagingWindow().state === 'open' (only checked for free-form)
  templateEligible: boolean | null;    // validateTemplateEligibility().ok (null for non-template)
  templateErrorCode: string | null;    // e.g. 'template_not_approved' (when !templateEligible)
};

export type RetryGateDecision =
  | { proceed: true }
  | { proceed: false; outcome: "policy_blocked"; code: string; category: "policy_blocked" };

/** A retry must NEVER assume the original send's conditions still hold.
 * Any gate that now fails -> policy_blocked (the worker dead-letters it so
 * Needs Attention surfaces it once; auto-retrying a config problem just
 * burns attempts and, for a bad credential, hammers Meta). Order: cheapest
 * / most fundamental first. */
export function evaluateRetryGates(g: RetryGateInput): RetryGateDecision {
  if (!g.workspaceActive) return { proceed: false, outcome: "policy_blocked", code: "workspace_suspended", category: "policy_blocked" };
  if (!g.hasCredential) return { proceed: false, outcome: "policy_blocked", code: "credential_unavailable", category: "policy_blocked" };

  if (g.messageType === "template") {
    if (g.templateEligible !== true) {
      return { proceed: false, outcome: "policy_blocked", code: g.templateErrorCode || "template_ineligible", category: "policy_blocked" };
    }
  } else {
    // Free-form: the 24-hour window may have closed since the original
    // attempt - a retry outside it must NOT free-form send (spec 11/14).
    if (!g.windowOpen) return { proceed: false, outcome: "policy_blocked", code: "messaging_window_closed", category: "policy_blocked" };
  }
  return { proceed: true };
}
