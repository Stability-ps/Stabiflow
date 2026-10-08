import type { FeatureFlagKey } from "@/lib/featureFlags";

// What each locked module does and which plans include it - mirrors the
// production plan -> module mapping (feature_flags.plan_codes). Shown on the
// lock screen so a locked area explains what, why and where to upgrade.
const BUSINESS_AND_GROWTH = "Business and Growth plans";
const GROWTH = "Growth plan";
export const MODULE_LOCK_INFO: Partial<Record<FeatureFlagKey, { name: string; plans: string; what: string }>> = {
  "module.content": { name: "Content", plans: BUSINESS_AND_GROWTH, what: "Store your images and schedule or publish posts to your Facebook Page and Instagram." },
  "module.leads": { name: "Leads", plans: BUSINESS_AND_GROWTH, what: "Capture enquiries, qualify them, schedule follow-ups and track your sales pipeline." },
  "module.customers": { name: "Customers", plans: BUSINESS_AND_GROWTH, what: "See everyone who bought from you, with their full history in Customer 360." },
  "module.campaigns": { name: "Campaigns", plans: GROWTH, what: "Build and publish Meta advertising campaigns and see what they bring in." },
  "module.creative_studio": { name: "Creative Studio", plans: GROWTH, what: "Create on-brand advert designs with AI." },
  "module.whatsapp": { name: "Messages", plans: GROWTH, what: "Run your WhatsApp Business conversations as a team in a shared inbox." },
  "module.analytics": { name: "Analytics", plans: GROWTH, what: "See spend, conversations, leads, customers and revenue across your funnel." },
  "module.flow_ai": { name: "Flow AI", plans: GROWTH, what: "Ask questions about your workspace data in plain English." },
  "module.automations": { name: "Automations", plans: GROWTH, what: "Take the next step automatically when something happens, with 2,000 runs per month." },
  "module.integrations": { name: "Integrations", plans: GROWTH, what: "Connect Meta (Facebook, Instagram, ads) and WhatsApp Business." },
};
