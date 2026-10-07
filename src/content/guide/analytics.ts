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
  keywords: ["reports", "kpi", "funnel", "conversion", "roas", "cost per lead", "attribution", "first touch", "last touch", "revenue", "date range", "lead sources", "creator", "creator campaign", "influencer", "ugc", "videos", "tiktok", "instagram", "youtube", "cpm", "cpi", "cac", "rpm"],
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
      id: "creator-campaigns",
      title: "Creator Campaigns",
      keywords: ["creator", "creator campaign", "influencer", "ugc", "paid creator", "videos", "tiktok", "instagram", "youtube", "cpm", "cpi", "cac", "rpm", "roas"],
      blocks: [
        { type: "p", text: "Creator Campaigns measures paid creator or UGC deals separately from advertising. Open Analytics → Creator campaigns to see which creators are actually producing installs, paying customers and revenue - not just views." },
        { type: "callout", tone: "tip", text: "Creator spend is not ad spend. If you pay a creator a fixed fee for a package of videos, enter that amount as the creator fee. Meta or other media spend remains advertising spend elsewhere in Analytics." },
        { type: "table", head: ["Step", "What to do"], rows: [
          ["1. Create the deal", "Choose New creator campaign. Enter the campaign name, creator, platform, creator fee, currency and number of videos contracted."],
          ["2. Record delivery", "Each time a contracted video is published, choose Add delivered video and add its post link and latest performance."],
          ["3. Add outcomes", "Record views, impressions, clicks, installs, leads, paying customers and revenue when those figures are available."],
          ["4. Review the funnel", "Compare views → installs → paid customers and check delivery progress, for example 17/30 videos."],
          ["5. Decide what to repeat", "Use acquisition cost and return metrics to compare creators and decide who is worth hiring again."],
        ] },
        { type: "p", text: "Example: you pay a creator $900 for 30 videos. Together the videos produce 600,000 views, 1,200 installs, 120 paying customers and $2,400 revenue. StabiFlow calculates $30 per contracted video, $1.50 CPM, $0.75 CPI, $7.50 CAC, $4.00 RPM and 2.67× revenue-to-creator-spend return." },
        { type: "table", head: ["Metric", "Meaning"], rows: [
          ["Cost / video", "Creator fee ÷ number of videos contracted."],
          ["CPM", "Creator fee ÷ views × 1,000. The effective cost of 1,000 creator views."],
          ["CPI", "Creator fee ÷ installs. The creator cost for each attributed install."],
          ["CAC", "Creator fee ÷ paying customers. The creator acquisition cost per paying customer."],
          ["RPM", "Revenue ÷ views × 1,000. Revenue generated per 1,000 creator views."],
          ["Return", "Revenue ÷ creator fee. For example, 2.67× means $2.67 of recorded revenue for each $1 paid to the creator."],
          ["View → install", "Installs ÷ views. Shows how effectively views become installs."],
          ["Install → paid", "Paying customers ÷ installs. Shows how effectively installs become paying customers."],
        ] },
        { type: "callout", tone: "tip", text: "A creator with fewer views can still be the better investment if their CPI, CAC and revenue return are stronger. Do not rank creators on views alone." },
        { type: "p", text: "Performance can be entered manually today. Where supported platform integrations are connected, synced metrics can update the same creator-post records; provider APIs may refresh periodically rather than second-by-second." },
      ],
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
