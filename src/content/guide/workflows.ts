import { EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const workflows: GuideChapter = {
  slug: "workflows",
  number: 21,
  title: "Common workflows",
  description: "Step-by-step, end-to-end examples that show how the areas of StabiFlow work together on real tasks.",
  part: "Reference",
  availability: EVERYONE,
  updated: GUIDE_UPDATED,
  related: ["messages", "leads", "campaigns", "automations"],
  keywords: ["how to", "examples", "process", "enquiry", "marketing campaign", "business setup", "template approval", "end to end"],
  sections: [
    {
      id: "new-enquiry",
      title: "1. A new customer enquiry on WhatsApp",
      keywords: ["enquiry", "whatsapp lead", "qualify", "follow up", "convert"],
      blocks: [
        { type: "workflow", stages: [
          { label: "WhatsApp message", detail: "A customer messages your business number.", chapter: "messages", section: "inbox" },
          { label: "Inbox", detail: "It appears in Messages. AI may reply, or it waits for your team.", chapter: "messages", section: "handover" },
          { label: "Lead created", detail: "Choose Create lead in the conversation.", chapter: "messages", section: "identity" },
          { label: "Qualification", detail: "Intake answers and your judgement decide if it's qualified.", chapter: "leads", section: "detail" },
          { label: "Follow-up", detail: "Assign the lead and set the next follow-up.", chapter: "leads", section: "detail" },
          { label: "Customer", detail: "Create an opportunity and mark it Won.", chapter: "leads", section: "opportunities" },
          { label: "Automation", detail: "Automate the repeatable parts.", chapter: "automations" },
          { label: "Analytics", detail: "See how enquiries convert.", chapter: "analytics" },
        ] },
        { type: "steps", steps: [
          { title: "Answer the customer", detail: "Open the chat. If it shows Needs human, choose Take over and reply. Use Agent assist if you'd like a suggested reply." },
          { title: "Create the lead", detail: "Choose Create lead. If StabiFlow finds an existing lead with the same number, link to it instead." },
          { title: "Qualify", detail: "Check What we've learned, then set Qualification on the lead." },
          { title: "Plan the follow-up", detail: "Assign the lead to the right person and set a follow-up date with a note." },
          { title: "Win the sale", detail: "Create an opportunity with its estimated value. When the customer buys, mark it Won - the customer is created automatically." },
          { title: "Automate next time", detail: "Create the automation \"New conversation creates a lead\" so step 2 happens on its own." },
        ] },
      ],
    },
    {
      id: "marketing-campaign",
      title: "2. Running a marketing campaign",
      keywords: ["advert", "campaign", "meta ads", "creative"],
      blocks: [
        { type: "workflow", stages: [
          { label: "Business profile", detail: "Complete My Business and link your brand.", chapter: "my-business" },
          { label: "Creative Studio", detail: "Generate and approve adverts.", chapter: "creative-studio" },
          { label: "Content", detail: "Optionally post organically too.", chapter: "content" },
          { label: "Campaign", detail: "Use in Campaign, then build and publish.", chapter: "campaigns" },
          { label: "Leads", detail: "WhatsApp enquiries become leads.", chapter: "leads" },
          { label: "Customers", detail: "Won opportunities become customers.", chapter: "customers" },
          { label: "Analytics", detail: "Compare cost per qualified lead and revenue.", chapter: "analytics" },
        ] },
        { type: "steps", steps: [
          { title: "Check your brand", detail: "Make sure the brand in Creative Studio has your logo, colours and contact details." },
          { title: "Create adverts", detail: "Describe your offer, choose formats and Generate Ads. Approve the best ones." },
          { title: "Start the campaign", detail: "Choose Use in Campaign on an approved advert. Pick the objective - Traffic with a WhatsApp destination works well for enquiries." },
          { title: "Publish safely", detail: "Complete the builder, save the draft, pass the readiness check and publish." },
          { title: "Handle the response", detail: "Work new conversations in Messages and turn them into leads." },
          { title: "Measure", detail: "Use the campaign's Journey and Performance tabs, and Analytics, to see what the campaign actually produced." },
        ] },
      ],
    },
    {
      id: "business-setup",
      title: "3. Setting up your business presence",
      keywords: ["profile", "public page", "pdf", "branding"],
      blocks: [
        { type: "workflow", stages: [
          { label: "Business Studio", detail: "Scan your website and review the facts.", chapter: "business-studio" },
          { label: "My Business", detail: "Fill the gaps and link your brand.", chapter: "my-business" },
          { label: "Documents", detail: "Create your company profile PDF.", chapter: "documents" },
          { label: "Public profile", detail: "Publish your hosted page and share its QR code.", chapter: "documents", section: "hosted-profile" },
          { label: "Content branding", detail: "AI captions and adverts now use your details.", chapter: "content" },
        ] },
      ],
    },
    {
      id: "whatsapp-template",
      title: "4. Getting a WhatsApp template approved and using it",
      keywords: ["template", "library", "meta approval", "variables"],
      blocks: [
        { type: "workflow", stages: [
          { label: "StabiFlow Library", detail: "Open Messages > Templates > StabiFlow Library.", chapter: "messages", section: "library" },
          { label: "Search", detail: "Filter by your industry and category." },
          { label: "Preview", detail: "Open a template." },
          { label: "Customise variables", detail: "Fill in {{1}}, {{2}}..." },
          { label: "Save", detail: "Save it to find it again later." },
          { label: "Prepare for Meta approval", detail: "Use this template copies the text; create and submit it in Meta." },
          { label: "Synced Meta template", detail: "Refresh numbers in WhatsApp Settings to sync it.", chapter: "messages", section: "meta-templates" },
          { label: "Approved", detail: "Wait for APPROVED status." },
          { label: "Use it", detail: "Send it from a conversation or an automation." },
        ] },
        { type: "callout", tone: "warning", text: "Until Meta approves it, a library template can't be sent. Rejected templates must be edited and resubmitted in Meta." },
      ],
    },
    {
      id: "what-next",
      title: "What should I do next?",
      keywords: ["coaching", "plan", "priorities", "recommendations"],
      blocks: [
        { type: "table", head: ["If you...", "Do this, in order"], rows: [
          ["Are new to StabiFlow", "1. Business Studio  2. My Business  3. Integrations  4. Messages  5. Leads"],
          ["Want more sales", "1. Complete your business details  2. Create content  3. Create a campaign  4. Capture leads  5. Follow up  6. Measure in Analytics"],
          ["Want less admin", "1. Connect WhatsApp  2. Set up Leads and your pipeline  3. Create automations  4. Check run history weekly"],
        ] },
      ],
    },
  ],
};
