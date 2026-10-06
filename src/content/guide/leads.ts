import { BUSINESS_AND_UP, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const leads: GuideChapter = {
  slug: "leads",
  number: 11,
  title: "Leads",
  description: "Capture every enquiry, qualify it, follow up on time and move it through your pipeline until it becomes a customer.",
  part: "Customers",
  availability: BUSINESS_AND_UP,
  appPath: "/app/leads",
  updated: GUIDE_UPDATED,
  related: ["customers", "messages", "automations"],
  keywords: ["crm", "pipeline", "stages", "qualification", "follow-up", "assign", "lost", "opportunity", "deal", "board", "kanban", "lead source"],
  sections: [
    {
      id: "what",
      title: "What a lead is",
      blocks: [
        { type: "p", text: "A lead is a person or business that has shown interest but hasn't bought yet - for example someone who messaged you on WhatsApp asking for a quote. Leads are the start of your sales process." },
        { type: "workflow", stages: [
          { label: "Lead", detail: "An enquiry is captured." },
          { label: "Qualified", detail: "You confirm it's a real opportunity." },
          { label: "Opportunity", detail: "A potential sale with a value and stage." },
          { label: "Won", detail: "The sale happens." },
          { label: "Customer", detail: "StabiFlow creates the customer record.", chapter: "customers" },
        ] },
        { type: "screenshot", shot: { src: "leads.webp", alt: "Leads board with New, Qualified, Proposal and Won columns and sample lead cards", caption: "The Board view. Each card shows the source and the lead reference." } },
      ],
    },
    {
      id: "sources",
      title: "Where leads come from",
      keywords: ["source", "whatsapp", "manual", "ads", "referral"],
      blocks: [
        { type: "list", items: [
          "WhatsApp - create a lead from a conversation in Messages (or let an automation do it).",
          "Manual - add a lead yourself with New lead.",
          "Your marketing - campaign and organic sources are recorded where StabiFlow can see them, so Analytics can show which channels bring leads.",
        ] },
      ],
    },
    {
      id: "create",
      title: "Creating a lead",
      keywords: ["new lead", "duplicate", "phone"],
      blocks: [
        { type: "steps", steps: [
          { title: "Choose New lead", detail: "On the Leads page." },
          { title: "Enter what you know", detail: "Contact name is required; phone, email and company are optional and can be added later." },
          { title: "Handle duplicates", detail: "If a lead with the same phone number already exists, StabiFlow shows it. Open the existing lead, or choose Create new anyway." },
        ] },
        { type: "p", text: "Every lead gets a reference number like LEAD-000123, which makes it easy to talk about with your team." },
      ],
    },
    {
      id: "views",
      title: "Board and list",
      keywords: ["board", "list", "filters", "overdue", "converted", "lost", "search"],
      blocks: [
        { type: "p", text: "Use Board to see leads in columns by pipeline stage, and List to search and filter. List filters: All leads, Active, Qualified, Needs follow-up, Overdue, Converted and Lost." },
      ],
    },
    {
      id: "detail",
      title: "Working a lead",
      keywords: ["assign", "qualification", "notes", "call", "whatsapp", "email", "summary", "attribution"],
      blocks: [
        { type: "p", text: "Open a lead to see everything in one place: contact details with Call, WhatsApp and Email buttons, the source, a summary of what the customer told you, attribution, attachments and notes." },
        { type: "table", head: ["Control", "What it does"], rows: [
          ["Assigned to", "Choose who is responsible for this lead."],
          ["Qualification", "Unqualified, Qualifying, Qualified or Not qualified. \"Not qualified\" needs a reason, so your team knows why later."],
          ["Next follow-up", "Set a date and note (\"What should happen next?\"). Mark it Done when complete."],
          ["Pipeline stage", "Move the lead to the right stage."],
          ["Notes", "Add a note for your team."],
          ["Mark lost / Reopen lead", "Close a lead that won't go ahead, with a reason such as No response or Price / budget."],
        ] },
        { type: "screenshot", shot: { src: "lead-detail.webp", alt: "Lead detail panel with assignment, qualification, follow-up and pipeline stage" } },
      ],
    },
    {
      id: "opportunities",
      title: "Opportunities and winning",
      keywords: ["opportunity", "deal", "won", "lost", "customer created"],
      blocks: [
        { type: "p", text: "When a lead is a real prospect, create an opportunity from the lead (or straight from the WhatsApp conversation). Give it a title, pipeline, stage, owner and estimated value." },
        { type: "list", items: [
          "Mark it Won when the sale happens - StabiFlow creates the customer automatically.",
          "Mark it Lost if it doesn't go ahead; you can Reopen it later.",
        ] },
        { type: "callout", tone: "tip", text: "Your workspace may use a different word for opportunities (for example \"Deal\"). The buttons use your workspace's wording." },
      ],
    },
    {
      id: "pipelines",
      title: "Pipeline settings",
      keywords: ["stages", "default pipeline", "rename stage", "reorder"],
      blocks: [
        { type: "p", text: "Every workspace starts with a default pipeline with New, Qualified, Proposal and Won stages. Choose Pipelines (top right of Leads) to open Pipeline settings, where you can rename it, create more pipelines (for example Sales and Service), set the default, and add, rename or reorder stages. Managers and above can change pipelines." },
      ],
    },
    {
      id: "permissions",
      title: "Who can do what",
      blocks: [
        { type: "table", head: ["Role", "Leads"], rows: [
          ["Owner, Admin, Manager", "Full access, including deleting leads and managing pipelines."],
          ["Sales", "Create, edit and assign leads; create and close opportunities."],
          ["Support", "View and create leads."],
          ["Marketing, Viewer", "View only."],
        ] },
      ],
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "A WhatsApp enquiry didn't become a lead",
            causes: ["Leads aren't created automatically unless you create one from the conversation or set up an automation."],
            check: ["Open the conversation in Messages - is there a Create lead button?"],
            fix: ["Choose Create lead, or create the automation \"New conversation creates a lead\"."],
          },
          {
            symptom: "I can't move a lead or change its stage",
            causes: ["Your role can view but not edit leads."],
            check: ["Settings > Members shows your role."],
            fix: ["Ask an admin for the Sales or Manager role."],
          },
        ] },
      ],
    },
  ],
};
