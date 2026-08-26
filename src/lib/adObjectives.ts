// Client-side mirror of supabase/functions/_shared/adObjectiveRules.ts -
// UX only (populating the Builder's Step 1 choices and CTA/destination
// pickers). The server independently re-validates every one of these
// rules before publishing - see ad-campaigns-publish/index.ts. Keep in
// sync by hand; if this drifts, the backend still refuses anything unsafe.
export type SupportedObjective = "OUTCOME_AWARENESS" | "OUTCOME_TRAFFIC" | "OUTCOME_ENGAGEMENT" | "OUTCOME_SALES";

export type DestinationType = "website" | "whatsapp" | "page_profile";

export type ObjectiveOption = {
  objective: SupportedObjective;
  label: string;
  description: string;
  allowedDestinationTypes: DestinationType[];
  allowedCtas: { value: string; label: string }[];
};

const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: "Learn More",
  SHOP_NOW: "Shop Now",
  SIGN_UP: "Sign Up",
  WHATSAPP_MESSAGE: "Send WhatsApp Message",
};

function cta(values: string[]) {
  return values.map((value) => ({ value, label: CTA_LABELS[value] || value }));
}

export const OBJECTIVE_OPTIONS: ObjectiveOption[] = [
  {
    objective: "OUTCOME_AWARENESS",
    label: "Awareness",
    description: "Show your ad to as many people as possible in your audience.",
    allowedDestinationTypes: ["page_profile", "website"],
    allowedCtas: cta(["LEARN_MORE"]),
  },
  {
    objective: "OUTCOME_TRAFFIC",
    label: "Traffic",
    description: "Send people to your website, or start a WhatsApp conversation.",
    allowedDestinationTypes: ["website", "whatsapp"],
    allowedCtas: cta(["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "WHATSAPP_MESSAGE"]),
  },
  {
    objective: "OUTCOME_ENGAGEMENT",
    label: "Engagement",
    description: "Get more likes, comments, and shares on your Page or Instagram profile.",
    allowedDestinationTypes: ["page_profile"],
    allowedCtas: cta(["LEARN_MORE"]),
  },
  {
    objective: "OUTCOME_SALES",
    label: "Sales",
    description: "Drive people to your website to shop (traffic-optimized - conversion tracking isn't set up yet).",
    allowedDestinationTypes: ["website"],
    allowedCtas: cta(["SHOP_NOW", "LEARN_MORE", "SIGN_UP"]),
  },
];

export function getObjectiveOption(objective: string): ObjectiveOption | undefined {
  return OBJECTIVE_OPTIONS.find((o) => o.objective === objective);
}

export const DESTINATION_TYPE_LABELS: Record<DestinationType, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  page_profile: "Facebook Page / Instagram profile",
};
