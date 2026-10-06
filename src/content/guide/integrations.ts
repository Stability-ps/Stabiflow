import { GROWTH, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const integrations: GuideChapter = {
  slug: "integrations",
  number: 16,
  title: "Integrations",
  description: "Connect Meta (Facebook Pages, Instagram and Ad Accounts) and WhatsApp Business, choose what StabiFlow may use, and keep the connections healthy.",
  part: "Automate & measure",
  availability: GROWTH,
  appPath: "/app/integrations",
  updated: GUIDE_UPDATED,
  related: ["messages", "content", "campaigns"],
  keywords: ["meta", "facebook", "instagram", "whatsapp business", "connect", "authorise", "permissions", "reconnect", "expired", "disconnect", "ad account", "page", "phone number"],
  sections: [
    {
      id: "supported",
      title: "Supported integrations",
      blocks: [
        { type: "table", head: ["Integration", "Lets you", "Status"], rows: [
          ["Meta", "Publish posts to Facebook Pages and Instagram, run ad campaigns and track advertising performance.", "Available"],
          ["WhatsApp Business Platform", "Receive and reply to customer conversations in Messages, with AI-assisted replies and approved-template messaging outside the 24-hour window.", "Available"],
          ["Google Ads", "-", "Coming later"],
          ["TikTok", "-", "Coming later"],
        ] },
        { type: "screenshot", shot: { src: "integrations.webp", alt: "Integrations page with Meta and WhatsApp cards" } },
      ],
    },
    {
      id: "connect",
      title: "Connecting",
      keywords: ["authorise", "login with facebook", "select page"],
      blocks: [
        { type: "workflow", stages: [
          { label: "Connect", detail: "Choose Connect on the Meta or WhatsApp card." },
          { label: "Authorise", detail: "Sign in to Facebook and approve the permissions StabiFlow asks for." },
          { label: "Select", detail: "Back in StabiFlow, choose which Pages, accounts or numbers to use." },
          { label: "Sync", detail: "StabiFlow discovers your resources (and WhatsApp templates)." },
          { label: "Verify", detail: "Use Check connection to confirm everything is healthy." },
        ] },
        { type: "callout", tone: "important", text: "Only a workspace owner or admin can connect providers. Approve all requested permissions in Facebook - skipping some can leave Pages or numbers missing." },
      ],
    },
    {
      id: "manage",
      title: "Managing a connection",
      keywords: ["manage", "refresh", "check connection", "enable", "disable"],
      blocks: [
        { type: "p", text: "Choose Manage on a connected card:" },
        { type: "list", items: [
          "Meta: tick the Facebook Pages, Instagram accounts (linked through Facebook) and Ad Accounts StabiFlow should use for this workspace.",
          "WhatsApp: tick the WhatsApp Business phone number(s) to use.",
          "Refresh finds newly added Pages, accounts or numbers (for WhatsApp it also re-syncs templates).",
          "Check connection tests each resource and highlights any that need attention.",
          "Disconnect removes the connection (owners and admins).",
        ] },
        { type: "callout", tone: "warning", text: "Meta connected but no Page selected? You'll see a warning - select at least one Facebook Page to publish content." },
      ],
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "Expired connection or \"needs attention\"",
            causes: ["You changed your Facebook password.", "Permissions were removed in Facebook.", "Meta expired the access."],
            check: ["Manage > Check connection."],
            fix: ["Connect again with the same Facebook account and approve all permissions."],
          },
          {
            symptom: "A Page, Instagram account or ad account is missing",
            causes: ["Your Facebook user doesn't have access to it in Meta Business settings.", "It wasn't selected during authorisation.", "Instagram isn't linked to a Facebook Page."],
            check: ["In Meta Business settings, confirm your access.", "Use Refresh in Manage."],
            fix: ["Grant access in Meta, then Refresh. If still missing, reconnect and select it."],
          },
          {
            symptom: "My WhatsApp number is missing",
            causes: ["The number belongs to a different WhatsApp Business account.", "It isn't fully registered at Meta yet."],
            check: ["WhatsApp > Manage lists the numbers found."],
            fix: ["Finish setup in Meta, then Refresh numbers."],
            contactSupport: "If the number shows in Meta but never in StabiFlow after refreshing, contact support with the number.",
          },
        ] },
      ],
    },
  ],
};
