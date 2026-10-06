import { EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const home: GuideChapter = {
  slug: "home",
  number: 3,
  title: "Home",
  description: "Your workspace at a glance: setup progress, key numbers, what needs attention and quick ways to start work.",
  part: "Start here",
  availability: EVERYONE,
  appPath: "/app",
  updated: GUIDE_UPDATED,
  related: ["getting-started", "analytics", "messages"],
  keywords: ["dashboard", "overview", "kpi", "widgets", "quick actions", "create", "needs attention", "recent activity"],
  sections: [
    {
      id: "purpose",
      title: "What Home is for",
      blocks: [
        { type: "p", text: "Home is the first page you see after signing in. It answers three questions: how is the business doing, what needs my attention, and what should I do next?" },
        { type: "p", text: "Home looks different depending on your plan. Workspaces with the advanced modules (for example on the Growth plan) see the full workspace overview described below. Workspaces focused on the business profile see a simpler welcome page with their profile completeness and a link to plans." },
        { type: "screenshot", shot: { src: "dashboard-home.webp", alt: "Workspace overview on Home with Create button, setup card and key numbers", caption: "The workspace overview." } },
      ],
    },
    {
      id: "create",
      title: "The Create button",
      keywords: ["quick actions", "new lead", "new content", "new campaign"],
      blocks: [
        { type: "p", text: "The Create button at the top right is the fastest way to start something new. It only offers actions your role is allowed to take:" },
        { type: "list", items: [
          "New lead - add someone to your pipeline.",
          "New content - create or upload marketing content.",
          "New campaign - build a campaign for Meta.",
          "Business profile - build or update your company profile in Business Studio.",
        ] },
      ],
    },
    {
      id: "setup-card",
      title: "Finish setting up StabiFlow",
      keywords: ["checklist", "onboarding", "progress"],
      blocks: [
        { type: "p", text: "Until your workspace is fully set up, Home shows a setup card with a progress bar and your next three steps. Items tick off automatically based on what you've actually done - for example, connecting WhatsApp, receiving your first conversation or creating your first automation." },
        { type: "list", items: [
          "Choose View all steps to see the complete list.",
          "Click any step to go straight to the right page.",
          "Use the X to hide the card on this device if you'd rather not see it.",
        ] },
        { type: "screenshot", shot: { src: "home-setup-checklist.webp", alt: "Setup card listing next steps such as Connect WhatsApp and Create your first lead" } },
      ],
    },
    {
      id: "numbers",
      title: "Key numbers (last 30 days)",
      keywords: ["kpi", "metrics", "spend", "conversations", "qualified leads", "customers", "revenue", "roas"],
      blocks: [
        { type: "p", text: "The number cards always cover the last 30 days and use exactly the same calculations as Analytics, so the two never disagree." },
        { type: "table", head: ["Card", "What it means"], rows: [
          ["Campaign spend", "What your Meta campaigns spent. Shows \"Meta not connected\" if there is no Meta connection."],
          ["Conversations", "WhatsApp conversations in the period."],
          ["Qualified leads", "Leads marked qualified in the period."],
          ["Customers", "New customers in the period."],
          ["Revenue and ROAS", "Revenue linked to your marketing and return on ad spend. Only visible to roles that can see revenue."],
        ] },
        { type: "callout", tone: "tip", text: "For other date ranges, comparisons with the previous period and the full funnel, open Analytics." },
      ],
    },
    {
      id: "needs-attention",
      title: "Needs attention",
      keywords: ["alerts", "urgent", "overdue", "failed"],
      blocks: [
        { type: "p", text: "This panel collects the things that need a person, most urgent first:" },
        { type: "list", items: [
          "Conversations handed to a human, customers waiting for a reply, and high-priority chats.",
          "Overdue handovers (your response-time target was missed).",
          "WhatsApp messages that could not be delivered.",
          "Inbox AI paused because the monthly usage limit was reached.",
          "Campaigns that failed to publish, integrations that need attention and automations that failed.",
          "Leads with nobody assigned, and billing or payment issues.",
        ] },
        { type: "p", text: "Each item links to where you can fix it. If your role can't act on an item, you'll see a View link instead." },
      ],
    },
    {
      id: "panels",
      title: "Campaigns, conversations, Flow AI and activity",
      blocks: [
        { type: "list", items: [
          "Campaign performance - your top campaigns by spend, or a prompt to connect Meta or create a campaign.",
          "Recent conversations - the latest WhatsApp chats, or a prompt to connect WhatsApp.",
          "Flow AI recommendations - a shortcut into Flow AI.",
          "Recent activity - the latest actions taken in this workspace.",
        ] },
      ],
    },
  ],
};
