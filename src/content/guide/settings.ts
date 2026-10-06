import { EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const settings: GuideChapter = {
  slug: "settings",
  number: 18,
  title: "Settings",
  description: "Manage your workspace profile, brand kit and data, your team and their roles, and your own account.",
  part: "Account",
  availability: EVERYONE,
  appPath: "/app/settings",
  updated: GUIDE_UPDATED,
  related: ["welcome", "billing", "getting-started"],
  keywords: ["workspace", "members", "team", "invite", "roles", "permissions", "account", "timezone", "currency", "logo", "export", "delete workspace", "brand kit", "security"],
  sections: [
    {
      id: "tabs",
      title: "The three tabs",
      blocks: [
        { type: "p", text: "Settings has three tabs: Workspace, Members and Account. Billing has its own page (Billing & plans), and channel settings live in their own areas (for example WhatsApp Settings in Messages)." },
        { type: "screenshot", shot: { src: "settings.webp", alt: "Settings page with Workspace, Members and Account tabs" } },
      ],
    },
    {
      id: "workspace",
      title: "Workspace",
      keywords: ["workspace name", "slug", "timezone", "currency", "description", "logo", "brand kit", "data export", "danger zone"],
      blocks: [
        { type: "table", head: ["Card", "What it controls"], rows: [
          ["Workspace profile", "Workspace name, URL slug, logo, business description, website, industry, timezone, currency, contact email and phone. Owners and admins can edit; everyone can see it."],
          ["Brand Kit", "Logo, colours and contact details used for adverts in Creative Studio."],
          ["Data export (owner only)", "Download a ZIP of your workspace: profile, members, conversations, leads, opportunities, customers, attribution, revenue, content, campaigns, automations and AI conversations."],
          ["Danger zone", "Delete the workspace (owner only). You must type the workspace name or slug to confirm."],
        ] },
        { type: "callout", tone: "important", text: "Timezone controls when scheduled posts and campaigns run and how dates appear in reports. Set it before scheduling anything." },
        { type: "callout", tone: "warning", text: "Deleting a workspace removes it for everyone. Download a data export first if you might need anything later." },
      ],
    },
    {
      id: "members",
      title: "Members and roles",
      keywords: ["invite", "invitation link", "revoke", "change role", "remove member", "seats"],
      blocks: [
        { type: "steps", steps: [
          { title: "Invite", detail: "Choose Invite, enter the email and role. StabiFlow creates an invitation link that expires after a set time - copy it and send it to your colleague." },
          { title: "Track invitations", detail: "Pending invitations lists invites not yet accepted. Revoke any you no longer need." },
          { title: "Change a role or remove someone", detail: "Use the controls next to each member." },
        ] },
        { type: "list", items: [
          "Only owners and admins can manage members.",
          "You can only grant roles up to your own level, and only an owner can make someone an owner.",
          "You can only change or remove members with a lower role than yours.",
          "The invitation must be accepted with the same email address it was sent to.",
          "Your plan sets the number of team seats. If none are free, Invite is disabled.",
        ] },
        { type: "p", text: "See Welcome > User roles for what each role can do." },
      ],
    },
    {
      id: "account",
      title: "Account",
      keywords: ["full name", "sign out", "privacy", "terms", "data deletion", "legal"],
      blocks: [
        { type: "p", text: "Your account details apply across every workspace you belong to. Update your full name, see which email you're signed in with, sign out, and open the Privacy Policy, Terms of Service and Data Deletion pages. Your legal agreement history is also shown here." },
      ],
    },
    {
      id: "security",
      title: "Security tips",
      blocks: [
        { type: "list", items: [
          "Give each person their own account - never share logins.",
          "Use the lowest role that lets someone do their job.",
          "Remove members as soon as they leave the business.",
          "Use Forgot password? on the sign-in page if you think your password is known to someone else.",
        ] },
      ],
    },
  ],
};
