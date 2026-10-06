import { GROWTH, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const flowAi: GuideChapter = {
  slug: "flow-ai",
  number: 14,
  title: "Flow AI",
  description: "Ask questions about your workspace in plain English and get answers and recommendations based on your real data.",
  part: "Automate & measure",
  availability: GROWTH,
  appPath: "/app/flow-ai",
  updated: GUIDE_UPDATED,
  related: ["analytics", "automations"],
  keywords: ["ai", "assistant", "chat", "ask", "questions", "recommendations", "insights", "read only"],
  sections: [
    {
      id: "what",
      title: "What Flow AI does",
      blocks: [
        { type: "p", text: "Flow AI is an assistant for your workspace. Ask it about campaigns, leads, revenue or WhatsApp performance and it looks up your data, explains what it found and suggests what to do next." },
        { type: "callout", tone: "important", text: "Flow AI only reads and recommends. It never changes anything in your workspace on its own." },
        { type: "screenshot", shot: { src: "flow-ai.webp", alt: "Flow AI chat with suggested questions" } },
      ],
    },
    {
      id: "access",
      title: "What Flow AI can look at",
      blocks: [
        { type: "list", items: [
          "Workspace totals: spend, conversations, leads, qualified leads, opportunities, customers and revenue for a date range.",
          "Campaign performance (spend, impressions, clicks, conversions, revenue and ROAS) and creative performance.",
          "Where leads come from (Meta paid, Facebook or Instagram organic, direct WhatsApp, referral, website, manual).",
          "WhatsApp conversion figures.",
          "Lists of campaigns, leads, opportunities, customers and content posts.",
          "Which integrations are connected (never passwords or tokens).",
          "The attribution trail for one specific conversation, lead, opportunity or customer.",
        ] },
      ],
    },
    {
      id: "cannot",
      title: "What it can't do",
      blocks: [
        { type: "list", items: [
          "It can't send messages, publish posts, change campaigns or edit records.",
          "It only sees data in your current workspace, and only what your role is allowed to see.",
          "It doesn't read your My Business profile or company documents - ask it about performance and activity, not about your company facts.",
        ] },
      ],
    },
    {
      id: "using",
      title: "Asking good questions",
      blocks: [
        { type: "p", text: "Start with a suggested question, or type your own. Examples:" },
        { type: "list", items: [
          "How are my campaigns performing?",
          "Which leads need attention?",
          "Summarise my open opportunities.",
          "What should I focus on today?",
          "Which lead source brought the most qualified leads last month?",
        ] },
        { type: "callout", tone: "tip", text: "Mention a time period (\"last 30 days\", \"this month\") for more precise answers. Earlier chats are kept in the conversation list so you can return to them." },
      ],
    },
    {
      id: "limits",
      title: "Usage and availability",
      blocks: [
        { type: "p", text: "Flow AI is part of the Growth plan and has a monthly usage allowance. All roles that can see the workspace can use it. If Flow AI isn't responding, the allowance may be used up or the service may be temporarily unavailable - try again later and check Billing & plans." },
      ],
    },
  ],
};
