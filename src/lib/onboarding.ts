export type OnboardingCounts = {
  members: number;
  metaConnected: boolean;
  whatsappConnected: boolean;
  defaultPipeline: boolean;
  content: number;
  campaigns: number;
  conversations: number;
  leadsOrOpportunities: number;
  flowAiConversations: number;
  automations: number;
  profileComplete: boolean;
  analyticsVisited: boolean;
};

export type OnboardingItem = {
  key: string;
  label: string;
  description: string;
  to: string;
  complete: boolean;
};

// Pure so the completion rules can be unit-tested without a live Supabase
// client - the hook that fetches OnboardingCounts is the only impure part.
export function computeOnboardingItems(counts: OnboardingCounts): OnboardingItem[] {
  return [
    {
      key: "workspace",
      label: "Create workspace",
      description: "Your workspace is set up.",
      to: "/settings",
      complete: true,
    },
    {
      key: "profile",
      label: "Complete company profile",
      description: "Add your business description, website, or industry so Flow AI and templates have real context.",
      to: "/settings",
      complete: counts.profileComplete,
    },
    {
      key: "team",
      label: "Invite your team",
      description: "Bring in teammates so work isn't blocked on one person.",
      to: "/settings",
      complete: counts.members > 1,
    },
    {
      key: "meta",
      label: "Connect Meta",
      description: "Link Facebook Pages, Instagram, and Ad Accounts to publish content and run campaigns.",
      to: "/integrations",
      complete: counts.metaConnected,
    },
    {
      key: "whatsapp",
      label: "Connect WhatsApp",
      description: "Link a WhatsApp Business number to receive and reply to real conversations.",
      to: "/integrations",
      complete: counts.whatsappConnected,
    },
    {
      key: "pipeline",
      label: "Confirm your CRM pipeline",
      description: "A default sales pipeline is created automatically for every workspace.",
      to: "/leads",
      complete: counts.defaultPipeline,
    },
    {
      key: "content",
      label: "Create your first content",
      description: "Upload media or draft a post in the Content library.",
      to: "/content/media-library",
      complete: counts.content > 0,
    },
    {
      key: "campaign",
      label: "Create your first campaign",
      description: "Launch a campaign once Meta is connected.",
      to: "/campaigns/new",
      complete: counts.campaigns > 0,
    },
    {
      key: "conversation",
      label: "Receive your first conversation",
      description: "Once WhatsApp is connected, incoming messages show up in the Inbox.",
      to: "/inbox",
      complete: counts.conversations > 0,
    },
    {
      key: "lead",
      label: "Create your first lead",
      description: "Add a lead manually or let one come in through WhatsApp/Ads.",
      to: "/leads",
      complete: counts.leadsOrOpportunities > 0,
    },
    {
      key: "analytics",
      label: "View Analytics",
      description: "See how campaigns, conversations, and revenue connect.",
      to: "/analytics",
      complete: counts.analyticsVisited,
    },
    {
      key: "flow-ai",
      label: "Try Flow AI",
      description: "Ask Flow AI a question about your performance - it only reads and recommends.",
      to: "/flow-ai",
      complete: counts.flowAiConversations > 0,
    },
    {
      key: "automation",
      label: "Create your first Automation",
      description: "Automate a repetitive action, like following up on a new lead.",
      to: "/automations",
      complete: counts.automations > 0,
    },
  ];
}

export function onboardingProgress(items: OnboardingItem[]): { completed: number; total: number } {
  return { completed: items.filter((item) => item.complete).length, total: items.length };
}
