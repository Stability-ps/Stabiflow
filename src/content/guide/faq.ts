import { EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter, GuideFaqItem, GuideSection } from "./types";

const group = (id: string, title: string, items: GuideFaqItem[]): GuideSection => ({ id, title, blocks: [{ type: "faq", items }] });

export const faq: GuideChapter = {
  slug: "faq",
  number: 23,
  title: "Questions and answers",
  description: "Quick, plain-English answers to the questions customers ask most.",
  part: "Reference",
  availability: EVERYONE,
  updated: GUIDE_UPDATED,
  related: ["troubleshooting", "welcome"],
  keywords: ["faq", "questions", "answers", "q&a"],
  sections: [
    group("getting-started", "Getting started", [
      { q: "What is StabiFlow?", a: "One workspace for running your business: your business profile, WhatsApp conversations, leads and customers, content and campaigns, automations and analytics - all connected." },
      { q: "Where should I start?", a: "Start with Business Studio and My Business so your business details are correct, then connect your channels in Integrations, then use Messages and Leads. The Getting started chapter has a full checklist." },
      { q: "Do I need a website to use StabiFlow?", a: "No. In Business Studio choose Start from scratch and enter your details yourself." },
      { q: "Is there a setup checklist?", a: "Yes. Home shows \"Finish setting up StabiFlow\" with your progress and next steps. It ticks items off automatically." },
    ]),
    group("account", "Account", [
      { q: "I forgot my password. What do I do?", a: "On the sign-in page choose Forgot password?, enter your email and follow the link we send you." },
      { q: "I didn't get the confirmation email.", a: "Check your spam folder. The sign-up screen lets you resend the confirmation email." },
      { q: "Can several team members use one workspace?", a: "Yes. Invite them in Settings > Members and give each person a role. The number of seats depends on your plan." },
      { q: "Can I belong to more than one workspace?", a: "Yes. Switch between them with the workspace switcher at the top (on a phone, tap the page title)." },
      { q: "Why does my invitation link say it was sent to a different email?", a: "Invitations can only be accepted by the email address they were sent to. Sign in with that email, or ask for a new invitation to your address." },
    ]),
    group("business", "Business", [
      { q: "What's the difference between Business Studio and My Business?", a: "My Business is where your business facts are stored. Business Studio is the guided builder that collects and checks those facts and turns them into a company profile PDF. Both work on the same record." },
      { q: "Will StabiFlow make up details about my business?", a: "No. Everything found by a scan or AI is a suggestion you must accept, and missing details are never invented." },
      { q: "Why does my PDF have a watermark?", a: "PDFs created on the Free plan are protected previews. Buy the Professional Profile or a subscription to create the clean PDF." },
      { q: "How do I get a public web page for my business?", a: "Go to Documents > Hosted business profile, choose your link and publish. Publishing is included with the Business and Growth plans." },
      { q: "Are my registration numbers public?", a: "No - they're private unless you tick Show on my public profile." },
      { q: "If I update My Business, do my existing PDFs change?", a: "No. PDFs are snapshots. Generate a new one in Business Studio." },
    ]),
    group("whatsapp", "WhatsApp", [
      { q: "Can StabiFlow send WhatsApp messages automatically?", a: "Yes, in two ways: AI can reply to customers while a conversation is in AI handling (never while a team member owns it), and automations can send approved WhatsApp templates." },
      { q: "What happens when the WhatsApp 24-hour window closes?", a: "You can't send normal messages until the customer messages again. You can still send an approved template." },
      { q: "How does a chat get handed to a person?", a: "When the customer asks for one, uses one of your handover phrases, when AI decides a person should help, or when the messaging window has closed. The chat then shows Needs human." },
      { q: "Will AI reply while I'm chatting with a customer?", a: "No. Once a team member takes over or replies, AI stays silent until you choose Return to automation." },
      { q: "Can my whole team use one WhatsApp number?", a: "Yes - that's what the shared inbox is for. Assign conversations so everyone knows who's handling what." },
      { q: "Can AI understand voice notes and attachments?", a: "Yes, if an owner or admin turns on voice-note transcription and attachment reading in WhatsApp Settings > Inbox AI." },
      { q: "Can StabiFlow reply outside business hours?", a: "Yes. In WhatsApp Settings > Business hours & replies you can send one automatic reply to customers who message outside your opening hours." },
    ]),
    group("templates", "Templates", [
      { q: "Why does Meta need to approve my WhatsApp template?", a: "WhatsApp requires businesses to use pre-approved templates to start conversations. It keeps WhatsApp free of spam and protects customers." },
      { q: "Can I use a StabiFlow Library template immediately?", a: "No. Library templates are starting points. Customise one, submit it in your Meta WhatsApp Business account and wait for approval. Once approved and synced, you can send it." },
      { q: "What do {{1}} and {{2}} mean?", a: "They're variables - placeholders for details that change, such as the customer's name or a date. You fill them in when customising or sending a template." },
      { q: "How do I get my new Meta templates into StabiFlow?", a: "Open WhatsApp Settings and choose Refresh numbers, which also re-syncs templates." },
      { q: "Can other people see the templates I save?", a: "No. Saved library templates are personal to you." },
    ]),
    group("leads", "Leads", [
      { q: "What is the difference between Leads and Customers?", a: "A lead is someone interested who hasn't bought yet. A customer has bought. Customers are created automatically when an opportunity is marked Won." },
      { q: "Are leads created automatically from WhatsApp?", a: "Not by default. Choose Create lead in a conversation, or create the automation \"New conversation creates a lead\"." },
      { q: "What happens if I add a lead that already exists?", a: "StabiFlow checks the phone number and offers to open the existing lead instead. You can still choose Create new anyway." },
      { q: "Can I change the pipeline stages?", a: "Yes. Owners, admins and managers can rename, add and reorder stages, and create more pipelines, in Pipeline settings." },
    ]),
    group("customers", "Customers", [
      { q: "How do I add a customer?", a: "Win an opportunity in Leads (or from a conversation) - the customer is created for you." },
      { q: "What is Customer 360?", a: "A single page showing everything about a customer: identity, revenue, attribution, journey, conversations, leads, opportunities, documents, notes and activity." },
    ]),
    group("campaigns", "Campaigns and content", [
      { q: "Does StabiFlow automatically publish content?", a: "Only when you tell it to: choose Publish now, or schedule a date and time. Nothing is posted without that." },
      { q: "Which social platforms are supported?", a: "Facebook Pages and Instagram accounts connected through Meta. LinkedIn isn't supported yet." },
      { q: "Is anything sent to Meta while I build a campaign?", a: "No. Campaigns stay as drafts in StabiFlow until you pass the readiness check and publish." },
      { q: "How often do campaign figures update?", a: "Meta figures sync automatically every 30 minutes while a campaign is active." },
      { q: "Can I use Creative Studio adverts in a campaign?", a: "Yes. Approve the advert, then choose Use in Campaign." },
    ]),
    group("automations", "Automations", [
      { q: "What can automations do?", a: "Create and assign leads and opportunities, move stages, add notes and tags, send in-app notifications, change conversation priority or handover, pause or resume AI, send WhatsApp templates, request documents and ask Flow AI for an analysis." },
      { q: "Can an automation loop forever?", a: "No. An automation never re-triggers itself, and chains of automations stop after five steps." },
      { q: "How do I know an automation worked?", a: "Open its run history from the ... menu. Failed automations also appear in Home > Needs attention." },
      { q: "Which plan includes automations?", a: "Automations are part of the Growth plan, with a monthly number of runs shown on Billing & plans." },
    ]),
    group("ai", "AI", [
      { q: "What does Flow AI know about my business?", a: "It can look up your workspace's performance and records - campaigns, leads, opportunities, customers, content, WhatsApp results and which integrations are connected - for what your role is allowed to see. It doesn't read your My Business profile." },
      { q: "Can Flow AI change things in my workspace?", a: "No. It only reads and recommends." },
      { q: "Does AI use my data from other workspaces?", a: "No. AI only works with the workspace you're in." },
      { q: "Why did the AI stop working?", a: "Usually because the monthly AI allowance for that feature has been used up. Check Billing & plans, or ask the owner about limits." },
      { q: "Should I check AI-written text?", a: "Always. AI suggestions are a starting point - review captions, adverts and replies before they go to customers." },
    ]),
    group("billing", "Billing", [
      { q: "How do I pay?", a: "Securely through Paystack. StabiFlow never sees or stores your card details." },
      { q: "Who can buy or change plans?", a: "Only the workspace owner." },
      { q: "What happens if I cancel?", a: "You won't be charged again and you keep access until the end of the period you've paid for." },
      { q: "What happens if I downgrade?", a: "There's no separate downgrade button. When paid access ends, areas outside your plan are hidden from the menu, but your data isn't deleted and returns if you subscribe again. Contact support if you need help changing plans." },
      { q: "Can I pay annually?", a: "Yes - use the monthly/annual toggle on Billing & plans to compare." },
    ]),
    group("security", "Security", [
      { q: "Can people in other workspaces see my data?", a: "No. Every workspace is isolated, and access is checked on the server for every request." },
      { q: "Can I control what each team member can do?", a: "Yes, with roles: Owner, Admin, Manager, Marketing, Sales, Support and Viewer." },
      { q: "Can I get a copy of my data?", a: "Yes. The owner can download a full ZIP export from Settings > Workspace > Data export." },
    ]),
    group("mobile", "Mobile", [
      { q: "Can I use StabiFlow on my phone?", a: "Yes. It works in your phone's browser, and you can install it on your home screen like an app." },
      { q: "How do I install StabiFlow on my phone?", a: "Android: open More and tap Install StabiFlow in Chrome. iPhone: in Safari, tap Share, then Add to Home Screen." },
      { q: "Where are the other areas on my phone?", a: "Home, Business, Messages and Leads are on the bottom bar; everything else is under More." },
    ]),
    group("troubleshooting", "Troubleshooting", [
      { q: "A page says it isn't available on my workspace. Why?", a: "That area isn't part of your current plan or isn't switched on for your workspace yet. Check Billing & plans." },
      { q: "Something looks wrong after an upgrade.", a: "Refresh the page. If the new areas still don't appear after a few minutes, contact support." },
      { q: "How do I contact support?", a: "Email contact@stabiflow.com with your workspace name and a short description of the problem. Never send passwords or card details." },
    ]),
  ],
};
