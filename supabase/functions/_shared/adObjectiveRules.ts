// Documented, supported objective model for the Campaigns module (Phase 6
// instruction #6). This is the single source of truth for which
// objectives StabiFlow can safely create, and what each one maps to on the
// Meta Marketing API - the Campaign Builder UI and the publish edge
// function both read from this module rather than each hardcoding their
// own copy.
//
// Graph API version: v21.0 (ODAX - "Outcome-Driven Ad Experiences" -
// objective model, the only objective model current Marketing API app
// review permits for new ad accounts as of this phase). Pre-2022
// objectives (LINK_CLICKS, PAGE_LIKES, CONVERSIONS, ...) are not used
// anywhere in this module.
//
// Supported: OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT,
// OUTCOME_SALES.
// NOT supported this phase (see schema migration header comment for why):
//   - OUTCOME_LEADS: requires a Meta Lead Ads instant-form resource, which
//     feeds directly into the (out-of-scope-for-Phase-6) Leads module.
//   - OUTCOME_APP_PROMOTION: no StabiFlow app destination exists.
// OUTCOME_SALES limitation: implemented as a traffic-to-destination
// objective (LINK_CLICKS optimization), not a true purchase-conversion
// objective, because StabiFlow has no Meta Pixel/Conversions API
// integration yet.

export type SupportedObjective = "OUTCOME_AWARENESS" | "OUTCOME_TRAFFIC" | "OUTCOME_ENGAGEMENT" | "OUTCOME_SALES";

export const SUPPORTED_OBJECTIVES: SupportedObjective[] = ["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_SALES"];

export type ObjectiveRule = {
  objective: SupportedObjective;
  label: string;
  description: string;
  optimizationGoal: string;
  billingEvent: string;
  allowedDestinationTypes: Array<"website" | "whatsapp" | "page_profile">;
  allowedCtas: string[];
};

const OBJECTIVE_RULES: Record<SupportedObjective, ObjectiveRule> = {
  OUTCOME_AWARENESS: {
    objective: "OUTCOME_AWARENESS",
    label: "Awareness",
    description: "Show your ad to as many people as possible in your audience.",
    optimizationGoal: "REACH",
    billingEvent: "IMPRESSIONS",
    allowedDestinationTypes: ["page_profile", "website"],
    allowedCtas: ["LEARN_MORE"],
  },
  OUTCOME_TRAFFIC: {
    objective: "OUTCOME_TRAFFIC",
    label: "Traffic",
    description: "Send people to your website, or start a WhatsApp conversation.",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "LINK_CLICKS",
    allowedDestinationTypes: ["website", "whatsapp"],
    allowedCtas: ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "WHATSAPP_MESSAGE"],
  },
  OUTCOME_ENGAGEMENT: {
    objective: "OUTCOME_ENGAGEMENT",
    label: "Engagement",
    description: "Get more likes, comments, and shares on your Page or Instagram profile.",
    optimizationGoal: "POST_ENGAGEMENT",
    billingEvent: "IMPRESSIONS",
    allowedDestinationTypes: ["page_profile"],
    allowedCtas: ["LEARN_MORE"],
  },
  OUTCOME_SALES: {
    objective: "OUTCOME_SALES",
    label: "Sales",
    description: "Drive people to your website to shop (traffic-optimized - no conversion tracking is configured yet).",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "LINK_CLICKS",
    allowedDestinationTypes: ["website"],
    allowedCtas: ["SHOP_NOW", "LEARN_MORE", "SIGN_UP"],
  },
};

export function isSupportedObjective(value: string): value is SupportedObjective {
  return (SUPPORTED_OBJECTIVES as string[]).includes(value);
}

export function getObjectiveRule(objective: string): ObjectiveRule | null {
  return isSupportedObjective(objective) ? OBJECTIVE_RULES[objective] : null;
}

export function listObjectiveRules(): ObjectiveRule[] {
  return SUPPORTED_OBJECTIVES.map((o) => OBJECTIVE_RULES[o]);
}

export function isDestinationTypeAllowed(objective: string, destinationType: string): boolean {
  const rule = getObjectiveRule(objective);
  return !!rule && (rule.allowedDestinationTypes as string[]).includes(destinationType);
}

export function isCtaAllowed(objective: string, cta: string): boolean {
  const rule = getObjectiveRule(objective);
  return !!rule && rule.allowedCtas.includes(cta);
}
