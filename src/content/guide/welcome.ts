import { AVAILABILITY_NOTE, EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const welcome: GuideChapter = {
  slug: "welcome",
  number: 1,
  title: "Welcome to StabiFlow",
  description: "What StabiFlow is, how the modules fit together, and how workspaces, roles and plans work.",
  part: "Start here",
  availability: EVERYONE,
  updated: GUIDE_UPDATED,
  related: ["getting-started", "home", "billing"],
  keywords: ["overview", "introduction", "what is stabiflow", "modules", "workspace", "roles", "plans"],
  sections: [
    {
      id: "what-is-stabiflow",
      title: "What StabiFlow is",
      blocks: [
        { type: "p", text: "StabiFlow brings the day-to-day running of a business into one workspace. You describe your business once, and StabiFlow uses those facts to build your company profile, support your marketing, organise customer conversations on WhatsApp, track leads and customers, automate repetitive steps and show you what is working." },
        { type: "p", text: "Instead of keeping your business details in one document, your WhatsApp chats on one phone, your leads in a spreadsheet and your adverts in another tool, everything lives in the same place and stays connected." },
        { type: "screenshot", shot: { src: "dashboard-home.webp", alt: "The StabiFlow Home dashboard with workspace overview, setup checklist and key numbers", caption: "Home: your workspace at a glance." } },
      ],
    },
    {
      id: "problem",
      title: "The problem it solves",
      blocks: [
        { type: "list", items: [
          "Business information is scattered, out of date or written differently in every document.",
          "Customer enquiries arrive on WhatsApp and get lost, forgotten or answered late.",
          "Nobody can see which enquiries became paying customers, or which marketing brought them in.",
          "The same small admin tasks are repeated by hand every day.",
        ] },
        { type: "p", text: "StabiFlow addresses each of these with a dedicated area, and joins the areas together so that information flows from one step to the next." },
      ],
    },
    {
      id: "how-it-fits",
      title: "How the platform fits together",
      keywords: ["journey", "flow", "relationship between modules"],
      blocks: [
        { type: "p", text: "Think of StabiFlow as a journey. Each stage feeds the next one:" },
        { type: "workflow", stages: [
          { label: "Set up your business", detail: "Business Studio and My Business hold your business facts.", chapter: "business-studio" },
          { label: "Connect integrations", detail: "Link Meta (Facebook, Instagram, ads) and WhatsApp Business.", chapter: "integrations" },
          { label: "Receive or create leads", detail: "Enquiries arrive on WhatsApp or are added by your team.", chapter: "leads" },
          { label: "Talk on WhatsApp", detail: "Reply, hand over between AI and people, and qualify enquiries.", chapter: "messages" },
          { label: "Turn leads into customers", detail: "Win an opportunity and a customer record is created.", chapter: "customers" },
          { label: "Create content and campaigns", detail: "Design adverts, schedule posts and run Meta campaigns.", chapter: "creative-studio" },
          { label: "Automate repetitive work", detail: "Let StabiFlow take the next step when something happens.", chapter: "automations" },
          { label: "Measure results", detail: "See spend, conversations, leads, customers and revenue together.", chapter: "analytics" },
        ] },
      ],
    },
    {
      id: "modules",
      title: "The main areas",
      blocks: [
        { type: "table", head: ["Area", "What it is for"], rows: [
          ["Home", "Your workspace overview, setup checklist and quick actions."],
          ["Business Studio", "Turns your website or business details into a professional company profile PDF."],
          ["My Business", "The single source of truth for your business facts."],
          ["Documents", "Your generated company profiles and your hosted public business page."],
          ["Creative Studio", "AI-assisted advert designs using your brand."],
          ["Content", "Media Library, calendar and scheduled Facebook and Instagram posts."],
          ["Campaigns", "Meta advertising campaigns, from draft to performance."],
          ["Messages", "Your WhatsApp Business inbox, contacts, templates and intake questions."],
          ["Leads", "Enquiries, qualification, follow-ups and your sales pipeline."],
          ["Customers", "Everyone who became a customer, with their full history (Customer 360)."],
          ["Analytics", "Spend, conversations, leads, customers and revenue across the funnel."],
          ["Flow AI", "Ask questions about your workspace data in plain English."],
          ["Automations", "When something happens, automatically take the next step."],
          ["Integrations", "Connect Meta and WhatsApp Business."],
          ["Billing", "Your plan, purchases and payment history."],
          ["Settings", "Workspace profile, team members and your account."],
        ] },
      ],
    },
    {
      id: "workspaces",
      title: "Workspaces",
      keywords: ["switch workspace", "multiple businesses", "tenant"],
      blocks: [
        { type: "p", text: "A workspace is one business inside StabiFlow. Everything you create - business details, conversations, leads, customers, content, campaigns and automations - belongs to that workspace and is only visible to its members." },
        { type: "list", items: [
          "You can belong to more than one workspace (for example, if you run two businesses or help a client).",
          "Switch workspaces from the workspace switcher at the top right on desktop. On your phone, tap the page title at the top of the screen (it shows your workspace name underneath).",
          "Data never crosses between workspaces. A customer in one workspace is invisible in another.",
        ] },
      ],
    },
    {
      id: "roles",
      title: "User roles",
      keywords: ["permissions", "owner", "admin", "manager", "marketing", "sales", "support", "viewer", "access"],
      blocks: [
        { type: "p", text: "Every member of a workspace has one role. The role decides what that person can see and change. StabiFlow checks the role on the server, so hiding a button is never the only protection." },
        { type: "table", head: ["Role", "Typical person", "What they can do"], rows: [
          ["Owner", "The business owner", "Everything, including billing, buying plans and deleting the workspace."],
          ["Admin", "Office or operations lead", "Everything except billing and workspace deletion. Can invite and manage members, and connect integrations."],
          ["Manager", "Team lead", "Run day-to-day work: content, campaigns, inbox, leads, pipelines, revenue and automations. Cannot connect integrations or manage members."],
          ["Marketing", "Marketer", "Content, media and campaigns. Can view leads, analytics and automations."],
          ["Sales", "Salesperson", "Create, edit and assign leads; manage opportunities and record revenue."],
          ["Support", "Customer support agent", "Work the WhatsApp inbox and create leads."],
          ["Viewer", "Accountant or advisor", "Read-only access to analytics, leads, campaigns and content."],
        ] },
        { type: "callout", tone: "note", text: "Only the owner and admins can edit My Business and build the company profile in Business Studio. Other roles can view them." },
      ],
    },
    {
      id: "plans",
      title: "Plans and feature availability",
      keywords: ["free", "professional profile", "business plan", "growth plan", "upgrade", "locked", "not available"],
      blocks: [
        { type: "p", text: "What you see in the menu depends on your plan. Areas that are not part of your plan are hidden from navigation rather than shown broken. If you open one through a link, StabiFlow explains that it isn't available yet and points you to Billing & plans." },
        { type: "table", head: ["Plan", "What it adds"], rows: [
          ["Free", "My Business, Documents and a protected Business Studio preview of your company profile."],
          ["Professional Profile (once-off)", "A clean, unwatermarked company profile PDF and premium profile designs. No recurring allowance."],
          ["Business", "Everything above plus Leads, Customers, Content and a hosted public business profile."],
          ["Growth", "Everything in Business plus Messages (WhatsApp), Campaigns, Creative Studio, Analytics, Flow AI, Automations and Integrations, with higher usage limits and more team members."],
        ] },
        { type: "callout", tone: "important", text: AVAILABILITY_NOTE },
        { type: "callout", tone: "tip", text: "Current prices are always shown on the Billing & plans page. This guide does not list prices because they can change." },
      ],
    },
    {
      id: "desktop-mobile",
      title: "Desktop and mobile layouts",
      keywords: ["phone", "pwa", "sidebar", "bottom navigation"],
      blocks: [
        { type: "p", text: "On a computer, StabiFlow uses a sidebar on the left grouped into Business, Marketing, Customers, Automations and Insights, plus Billing and Settings. On a phone, a bottom bar gives you Home, Business, Messages, Leads and More." },
        { type: "p", text: "Everything you can do on desktop is available on mobile; only the layout changes. See the Mobile chapter for details and for installing StabiFlow on your phone." },
      ],
    },
  ],
};
