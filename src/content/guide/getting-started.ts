import { EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const gettingStarted: GuideChapter = {
  slug: "getting-started",
  number: 2,
  title: "Getting started",
  description: "Your first hour in StabiFlow: sign in, set up your workspace and business, connect your channels and invite your team.",
  part: "Start here",
  availability: EVERYONE,
  updated: GUIDE_UPDATED,
  related: ["welcome", "business-studio", "my-business", "integrations", "settings"],
  keywords: ["onboarding", "setup", "first steps", "sign up", "log in", "checklist", "new account"],
  sections: [
    {
      id: "sign-in",
      title: "1. Create your account or sign in",
      keywords: ["login", "log in", "sign up", "register", "password", "forgot password", "confirm email"],
      blocks: [
        { type: "steps", steps: [
          { title: "Go to app.stabiflow.com", detail: "Choose Sign in if you already have an account, or create one with your full name, email and a password." },
          { title: "Confirm your email", detail: "New accounts receive a confirmation email. Open it and click the link. If it hasn't arrived, check your spam folder - the sign-up screen lets you resend it." },
          { title: "Sign in", detail: "Enter your email and password. If you forget your password, use Forgot password? on the sign-in screen and follow the emailed link." },
        ] },
        { type: "callout", tone: "tip", text: "Were you invited by a colleague? Open the invitation link they sent you. Sign in (or create an account with the same email address the invitation was sent to) and you'll join their workspace automatically." },
      ],
    },
    {
      id: "workspace",
      title: "2. Create or choose your workspace",
      keywords: ["create workspace", "company name", "switch workspace"],
      blocks: [
        { type: "p", text: "The first time you sign in without an invitation, StabiFlow asks for your company name and creates a workspace for your business. You become its owner." },
        { type: "p", text: "If you belong to several workspaces, check the workspace name at the top of the screen before you start working - everything you do happens in the workspace that is currently selected." },
      ],
    },
    {
      id: "business-setup",
      title: "3. Complete your business details",
      blocks: [
        { type: "p", text: "Your business details are used everywhere: your company profile, your public business page, AI-written wording and your adverts. Getting them right first saves time later." },
        { type: "steps", steps: [
          { title: "Open Business Studio", detail: "If you have a website, enter its address and choose Scan my website. StabiFlow reads a few public pages and suggests facts for you to check." },
          { title: "Review every suggestion", detail: "Accept what is right, correct what is nearly right and reject the rest. Nothing is saved without your approval." },
          { title: "Fill the gaps in My Business", detail: "Add contact details, locations, at least three services or products, your team, projects and registrations." },
          { title: "Link your brand", detail: "In My Business > Brand, choose or create a brand with your logo and colours." },
        ] },
        { type: "screenshot", shot: { src: "my-business-overview.webp", alt: "My Business page showing profile setup progress and sections", caption: "My Business shows how complete your profile is and what is still missing." } },
      ],
    },
    {
      id: "account-details",
      title: "4. Review your account and workspace settings",
      keywords: ["timezone", "currency", "full name"],
      blocks: [
        { type: "list", items: [
          "Settings > Account: check your full name. This is how teammates see you.",
          "Settings > Workspace: set your timezone and currency. Scheduled posts, campaign start times and reports all use the workspace timezone.",
        ] },
        { type: "callout", tone: "important", text: "Set the workspace timezone before you schedule any content or campaigns, so that times are shown and run the way you expect." },
      ],
    },
    {
      id: "integrations",
      title: "5. Connect Meta and WhatsApp",
      blocks: [
        { type: "p", text: "On plans that include Integrations, connect Meta to publish Facebook and Instagram posts and run adverts, and connect WhatsApp Business to receive and reply to customer messages in StabiFlow." },
        { type: "p", text: "Only the workspace owner or an admin can connect integrations. See the Integrations chapter for the step-by-step flow and troubleshooting." },
      ],
    },
    {
      id: "team",
      title: "6. Invite your team",
      keywords: ["invite", "members", "seats"],
      blocks: [
        { type: "steps", steps: [
          { title: "Open Settings > Members", detail: "Choose Invite, enter your colleague's email and pick a role." },
          { title: "Share the invitation link", detail: "StabiFlow creates a link and shows it to you. Copy it and send it to your colleague - they open it, sign in or sign up, and join." },
          { title: "Check pending invitations", detail: "Unaccepted invitations are listed under Pending invitations, where you can revoke them." },
        ] },
        { type: "callout", tone: "note", text: "The number of team members depends on your plan. If the Invite button is disabled, your plan has no free seats - see Billing & plans." },
      ],
    },
    {
      id: "billing",
      title: "7. Review your plan",
      blocks: [
        { type: "p", text: "Open Billing & plans to see your current plan, compare plans and pay securely with Paystack. Only the workspace owner can buy or change plans." },
      ],
    },
    {
      id: "messages",
      title: "8. Set up Messages",
      blocks: [
        { type: "p", text: "Once WhatsApp is connected, open Messages. Check that your templates have synced, set your business hours and out-of-hours reply, add any extra phrases that should hand a chat to a person, and (optionally) create intake questions so StabiFlow can qualify new enquiries." },
      ],
    },
    {
      id: "leads-customers",
      title: "9. Start working with leads and customers",
      blocks: [
        { type: "p", text: "Every workspace gets a default sales pipeline automatically. Add your first lead from Leads > New lead, or let one come in from WhatsApp. When a lead's opportunity is won, StabiFlow creates the customer for you." },
      ],
    },
    {
      id: "checklist",
      title: "Getting started checklist",
      keywords: ["todo", "setup list"],
      blocks: [
        { type: "p", text: "Use this list to make sure nothing is missed. Your Home page also shows a live setup checklist that ticks items off as you complete them." },
        { type: "checklist", items: [
          "Business information completed (Company and About in My Business)",
          "Company profile created in Business Studio",
          "Logo and brand colours linked (My Business > Brand)",
          "Contact details and location added",
          "Meta and WhatsApp connected (Integrations)",
          "WhatsApp settings and templates checked (Messages)",
          "Team invited with the right roles (Settings > Members)",
          "Plan reviewed (Billing & plans)",
          "Timezone and currency set (Settings > Workspace)",
        ] },
        { type: "screenshot", shot: { src: "home-setup-checklist.webp", alt: "Finish setting up StabiFlow card on the Home page with progress bar and next steps", caption: "The setup card on Home ticks items off automatically." } },
      ],
    },
  ],
};
