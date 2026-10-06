import { GROWTH, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const analytics: GuideChapter = {
  slug: "analytics",
  number: 15,
  title: "Analytics",
  description: "See your whole funnel - from ad spend to conversations, leads, customers and revenue - and learn how to read the numbers.",
  part: "Automate & measure",
  availability: GROWTH,
  appPath: "/app/analytics",
  updated: GUIDE_UPDATED,
  related: ["campaigns", "customers", "flow-ai"],
  keywords: ["reports", "kpi", "funnel", "conversion", "roas", "cost per lead", "attribution", "first touch", "last touch", "revenue", "date range", "lead sources"],
  sections: [
    {
      id: "overview",
      title: "What Analytics shows",
      blocks: [
        { type: "p", text: "Analytics joins your marketing, conversations and sales into one picture: what you spent, how many conversations and leads it produced, how many became customers and what revenue followed." },
        { type: "screenshot", shot: { src: "analytics.webp", alt: "Analytics overview with KPI cards, conversion funnel and lead sources" } },
      ],
    },
    {
      id: "controls",
      title: "Date ranges and attribution model",
      keywords: ["last 7 days", "last 30 days", "this month", "custom range", "previous period"],
      blocks: [
        { type: "p", text: "Choose a period: Last 7 days, Last 30 days, Last 90 days, This month, Last month or a Custom range. Most cards compare against the previous period of the same length." },
        { type: "table", head: ["Attribution model", "Gives credit to..."], rows: [
          ["First touch", "The first thing that brought the person to you."],
          ["Last touch", "The last thing before they converted."],
          ["First paid touch", "The first paid ad they interacted with."],
          ["Last paid touch", "The last paid ad before they converted."],
        ] },
        { type: "callout", tone: "tip", text: "No model is \"more correct\" - they answer different questions. Use first touch to see what starts conversations, and last touch to see what closes them." },
      ],
    },
    {
      id: "kpis",
      title: "KPI cards",
      blocks: [
        { type: "table", head: ["Card", "How to read it"], rows: [
          ["Ad Spend", "Money spent on Meta campaigns."],
          ["Conversations, Leads, Qualified Leads, Opportunities, Customers", "How many of each in the period, with the change versus the previous period."],
          ["Recorded Revenue", "Revenue recorded against customers (visible to roles that can see revenue)."],
          ["Cost / Conversation, Lead, Qualified Lead, Opportunity, Customer", "Spend divided by the number of outcomes - how much each result costs you."],
        ] },
      ],
    },
    {
      id: "funnel",
      title: "Conversion funnel and lead sources",
      blocks: [
        { type: "p", text: "The conversion funnel shows Conversations → Leads → Qualified Leads → Opportunities → Customers, with the overall conversation-to-customer rate. Where leads come from breaks leads down by source." },
        { type: "list", items: [
          "A big drop from conversations to leads: enquiries aren't being captured - consider an automation that creates leads.",
          "A big drop from leads to qualified: you may be attracting the wrong audience - review campaign targeting.",
          "A big drop from opportunities to customers: look at follow-up speed and lost reasons.",
        ] },
      ],
    },
    {
      id: "campaigns",
      title: "Campaign and creative performance",
      blocks: [{ type: "p", text: "Tables compare campaigns and creatives by spend, results, conversions and revenue under the selected attribution model. Use them to decide where to put more budget." }],
    },
    {
      id: "crm",
      title: "CRM performance",
      blocks: [{ type: "p", text: "For leads created in the period: qualification rate, lead conversion rate, follow-ups due and overdue, lead outcomes (active, converted, lost) and why leads were lost. Overdue follow-ups are the quickest win - clear them first." }],
    },
    {
      id: "whatsapp",
      title: "WhatsApp performance",
      blocks: [{ type: "p", text: "Analytics shows how WhatsApp conversations convert into leads and customers. For operational figures - response times, handover rate and resolution time - see Messages analytics in the Messages chapter." }],
    },
    {
      id: "revenue",
      title: "Revenue view",
      keywords: ["revenue attribution", "roas"],
      blocks: [{ type: "p", text: "Roles that can see revenue get a Revenue tab: revenue by attribution evidence, by how the conversation was handled (AI or human), over time, and by campaign. Different currencies are always shown separately." }],
    },
    {
      id: "interpret",
      title: "Reading the numbers well",
      blocks: [
        { type: "list", items: [
          "Look at trends, not single days - small numbers move a lot.",
          "Compare cost per qualified lead, not just cost per lead.",
          "Revenue appears only when it's recorded, so a quiet revenue line may mean it hasn't been entered yet.",
          "\"Not enough data yet\" is normal for new workspaces.",
        ] },
      ],
    },
  ],
};
