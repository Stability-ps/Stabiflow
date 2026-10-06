import { EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const mobile: GuideChapter = {
  slug: "mobile",
  number: 19,
  title: "Using StabiFlow on your phone",
  description: "Install StabiFlow like an app, find your way around the bottom bar and More menu, and work WhatsApp and leads on the go.",
  part: "Account",
  availability: EVERYONE,
  updated: GUIDE_UPDATED,
  related: ["messages", "leads", "my-business"],
  keywords: ["mobile", "phone", "pwa", "install", "home screen", "app", "android", "iphone", "ios", "bottom bar", "more menu", "business hub"],
  sections: [
    {
      id: "navigation",
      title: "Bottom bar and More menu",
      blocks: [
        { type: "p", text: "On a phone, StabiFlow shows a bottom bar with your most-used areas:" },
        { type: "table", head: ["Tab", "Opens"], rows: [
          ["Home", "Your workspace overview."],
          ["Business", "The Business hub - Business Studio, My Business, Documents and quick links to every profile section."],
          ["Messages", "Your WhatsApp inbox."],
          ["Leads", "Your leads and pipeline."],
          ["More", "Everything else: Documents, Creative Studio, Content, Campaigns, Customers, Analytics, Flow AI, Automations, Integrations, Billing, Settings, and Help & guide."],
        ] },
        { type: "p", text: "Tabs only appear for areas your plan includes, so a workspace without Messages or Leads simply has fewer tabs. On detail pages, a back arrow at the top returns you to the previous screen. Tap the page title to switch workspace." },
        { type: "screenshot", shot: { src: "mobile-home.webp", alt: "StabiFlow Home on a phone with the bottom navigation bar", mobile: true } },
        { type: "screenshot", shot: { src: "mobile-more.webp", alt: "The More menu on a phone listing all other areas", mobile: true } },
      ],
    },
    {
      id: "business-hub",
      title: "The Business hub",
      blocks: [
        { type: "p", text: "The Business tab brings your business tools together: Your business (Business Studio, My Business, Documents), Profile details (Company, About, Services & products, Brand assets, Team, Projects & case studies, Certifications & registrations) and Create (Company profile PDF and, where available, Content). It also shows your profile completeness." },
        { type: "screenshot", shot: { src: "mobile-business-hub.webp", alt: "Business hub on a phone", mobile: true } },
      ],
    },
    {
      id: "install",
      title: "Installing StabiFlow on your phone",
      keywords: ["install", "add to home screen", "pwa"],
      blocks: [
        { type: "steps", steps: [
          { title: "Android (Chrome)", detail: "Open app.stabiflow.com in Chrome, sign in, open More and tap Install StabiFlow. If it says Chrome is still preparing the install, wait a moment and try again - don't add a plain shortcut instead." },
          { title: "iPhone (Safari)", detail: "Open app.stabiflow.com in Safari, tap Share, then Add to Home Screen." },
          { title: "Open it from your home screen", detail: "The installed app opens without the browser bar, like a normal app." },
        ] },
      ],
    },
    {
      id: "on-the-go",
      title: "Working on the go",
      blocks: [
        { type: "list", items: [
          "Messages works fully on a phone: read, reply, take over, assign and add notes.",
          "From a lead, use Call, WhatsApp and Email buttons to contact the person directly.",
          "Screens adapt to your phone - wide tables scroll sideways inside their card, never the whole page.",
        ] },
      ],
    },
  ],
};
