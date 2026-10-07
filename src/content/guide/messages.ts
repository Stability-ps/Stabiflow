import { GROWTH, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const messages: GuideChapter = {
  slug: "messages",
  number: 10,
  title: "Messages (WhatsApp)",
  description: "Run customer conversations on WhatsApp as a team: the shared inbox, AI and human handover, contacts, templates, intake questions, analytics and settings.",
  part: "Customers",
  availability: GROWTH,
  appPath: "/app/whatsapp/inbox",
  updated: GUIDE_UPDATED,
  related: ["integrations", "leads", "automations", "troubleshooting"],
  keywords: ["whatsapp", "inbox", "chat", "conversation", "reply", "handover", "handoff", "take over", "ai", "bot", "24-hour window", "templates", "meta templates", "library", "intake", "contacts", "sla", "business hours"],
  sections: [
    {
      id: "overview",
      title: "How Messages works",
      blocks: [
        { type: "p", text: "Messages connects your WhatsApp Business number to StabiFlow so your whole team can see and answer customer conversations from one shared inbox - on a computer or a phone. Conversations can be handled by AI and automations, by people, or a mix of both, and every chat can become a lead and then a customer." },
        { type: "p", text: "Messages has five tabs - Inbox, Contacts, Templates, Intake and Analytics - and a settings button (the gear icon) for WhatsApp Settings." },
        { type: "callout", tone: "important", text: "Messages needs WhatsApp Business connected in Integrations. Until then, the page shows Connect WhatsApp Business." },
        { type: "screenshot", shot: { src: "whatsapp-inbox.webp", alt: "Messages showing Connect WhatsApp Business, before a WhatsApp number is connected", caption: "Before WhatsApp Business is connected, every Messages tab shows this. Connect it to unlock the inbox, contacts, templates and intake." } },
      ],
    },
    {
      id: "inbox",
      title: "A. Inbox",
      keywords: ["conversations", "unread", "views", "mine", "unassigned", "needs human", "ai handling", "closed", "filters", "search", "priority", "overdue"],
      blocks: [
        { type: "p", text: "The left side lists conversations; pick one to open the chat on the right. Search by name or number, and use the quick views to focus:" },
        { type: "table", head: ["View", "Shows"], rows: [
          ["All", "Every conversation."],
          ["Mine", "Conversations assigned to you."],
          ["Unassigned", "Nobody owns these yet."],
          ["AI handling", "AI and automations are replying."],
          ["Needs human", "Handed to the team and not yet taken over."],
          ["Closed", "Resolved conversations."],
          ["Unread", "Conversations with messages you haven't read (unread is tracked per person)."],
        ] },
        { type: "p", text: "Filters narrow the list further by inbox status (unassigned, assigned, waiting on client, resolved), assignee, priority (normal, high, urgent) and handling (AI active or human attention). Active filters appear as chips you can clear one by one. An Overdue badge means your response-time target was missed." },
      ],
    },
    {
      id: "handover",
      title: "AI and human handover",
      keywords: ["take over", "pause ai", "return to automation", "human", "bot", "handoff phrases"],
      blocks: [
        { type: "p", text: "Every conversation is in one of five handling states, shown as a badge:" },
        { type: "table", head: ["State", "What it means"], rows: [
          ["AI handling", "AI and automations may reply."],
          ["Needs human", "Waiting for a team member to take over. AI is silent."],
          ["Human", "A team member owns the conversation. AI never replies automatically."],
          ["AI paused", "AI is switched off for this conversation, without a handover."],
          ["Closed", "Resolved. A new customer message reopens it for the team."],
        ] },
        { type: "p", text: "A conversation moves to Needs human when the customer asks for a person (for example \"speak to a consultant\" or \"call me\"), when one of your own handover phrases is used, when AI decides a person should help, or when the messaging window has closed." },
        { type: "steps", steps: [
          { title: "Take over", detail: "You become the owner and AI stops replying automatically." },
          { title: "Pause AI", detail: "Silence AI on this chat without assigning it to anyone." },
          { title: "Return to automation", detail: "Hand the chat back to AI and automations (you'll be asked to confirm)." },
          { title: "Resolve / Reopen chat", detail: "Close the conversation when it's done; reopen it if needed." },
        ] },
        { type: "callout", tone: "tip", text: "Replying to a customer yourself counts as taking over - AI won't talk over you." },
      ],
    },
    {
      id: "replying",
      title: "Replying, notes and the 24-hour window",
      keywords: ["reply", "send", "template", "internal note", "24 hour", "messaging window", "closed window", "delivery failed", "retry"],
      blocks: [
        { type: "p", text: "Type in the reply box and send. A badge at the top of the chat shows whether the WhatsApp messaging window is open." },
        { type: "callout", tone: "important", title: "The 24-hour window", text: "WhatsApp only lets businesses send normal messages within 24 hours of the customer's last message. After that, a normal reply can't be sent until the customer messages again - or you send an approved template, which you choose from the list under the reply box and fill in its parameters." },
        { type: "list", items: [
          "Internal notes are for your team only and are never sent to the customer.",
          "Assign to... sets who owns the conversation; the assignee is notified.",
          "If a message fails to deliver, you'll see a warning and can retry it.",
          "Voice notes can be transcribed and attachments read by AI, if switched on in WhatsApp Settings.",
        ] },
      ],
    },
    {
      id: "assist",
      title: "Agent assist (AI drafts)",
      keywords: ["suggest reply", "follow-up", "improve", "shorten", "professional", "summarise", "next action", "intent"],
      blocks: [
        { type: "p", text: "Agent assist helps you write - it never sends anything on its own. Options:" },
        { type: "list", items: [
          "Suggest a reply, or Draft a follow-up.",
          "Improve my reply, Shorten, or Make professional (for text you've already typed).",
          "Summarise conversation, Suggest next action, or Identify customer intent.",
        ] },
        { type: "callout", tone: "note", text: "Internal notes are not shared with the AI. Agent assist uses the same monthly Inbox AI allowance as automatic replies." },
      ],
    },
    {
      id: "identity",
      title: "Customer identity, leads and customers",
      keywords: ["create lead", "link lead", "link customer", "customer 360", "what we've learned", "opportunity"],
      blocks: [
        { type: "p", text: "The panel beside the chat shows who you're talking to and what StabiFlow has learned from the conversation." },
        { type: "list", items: [
          "Create lead - turn this conversation into a lead. If a lead with the same phone number exists, StabiFlow offers to link to it instead.",
          "Open lead / create an opportunity - jump to the lead or start an opportunity (deal) from the chat.",
          "Link customer - connect the chat to an existing customer, then Open Customer 360.",
          "What we've learned - answers collected by your intake questions. You can correct an answer or ask the next question.",
        ] },
      ],
    },
    {
      id: "contacts",
      title: "B. Contacts",
      keywords: ["contact list", "phone numbers"],
      blocks: [
        { type: "p", text: "Contacts lists everyone who has messaged your WhatsApp number, created automatically from your conversations. Search by name or number. A Lead badge shows contacts that already have a lead." },
      ],
    },
    {
      id: "templates",
      title: "C. Templates",
      keywords: ["meta templates", "approved", "pending", "rejected", "stabiflow library", "starter templates", "variables", "{{1}}", "favourites", "saved", "use this template", "utility", "marketing", "industries"],
      blocks: [
        { type: "p", text: "WhatsApp templates are pre-approved message formats. You need one to message a customer outside the 24-hour window, and automations use them to send messages. The Templates tab has two parts: My Meta templates and the StabiFlow Library." },
      ],
    },
    {
      id: "meta-templates",
      title: "My Meta templates",
      keywords: ["synced", "approved", "pending", "rejected", "paused", "disabled", "refresh from meta", "preview", "copy template"],
      blocks: [
        { type: "p", text: "These are the templates in your Meta WhatsApp Business account, synced into StabiFlow. The header shows how many are synced and how many are approved." },
        { type: "list", items: [
          "Search by name, language or message text.",
          "Filter by category and status.",
          "Choose a template (or Preview) to read the full message and copy it.",
        ] },
        { type: "table", head: ["Status", "Meaning"], rows: [
          ["APPROVED", "Meta approved it - it can be sent."],
          ["PENDING", "Waiting for Meta's review."],
          ["REJECTED", "Meta declined it. Edit and resubmit it in Meta."],
          ["PAUSED / DISABLED", "Meta has stopped it, often due to quality issues."],
        ] },
        { type: "callout", tone: "important", text: "Templates are created and approved in Meta, not in StabiFlow. StabiFlow reads them. Only APPROVED templates can be sent." },
        { type: "p", text: "To pull in new or updated templates, use Refresh from Meta - it takes you to WhatsApp Settings, where Refresh numbers re-syncs your numbers and templates." },
      ],
    },
    {
      id: "library",
      title: "StabiFlow Library",
      keywords: ["library", "starter templates", "3,250", "50 industries", "save", "favourites", "variables", "customise", "use this template"],
      blocks: [
        { type: "p", text: "The StabiFlow Library contains more than 3,000 ready-to-customise template ideas across 50 industries, in Utility and Marketing categories. Use it to find good wording quickly." },
        { type: "steps", steps: [
          { title: "Open the library", detail: "In Templates, choose StabiFlow Library." },
          { title: "Find a starting point", detail: "Search by template name or use case, and filter by industry and category." },
          { title: "Preview it", detail: "Choose a template to open it." },
          { title: "Customise the variables", detail: "Fill in each variable - shown as {{1}}, {{2}} and so on - and watch the message update. Leave a field blank to keep the placeholder." },
          { title: "Save it (optional)", detail: "Choose Save to add it to your saved templates. Use the Saved filter to see them. Saved templates are personal to you." },
          { title: "Use this template", detail: "This copies the customised text to your clipboard." },
          { title: "Submit it to Meta", detail: "Create the template in your Meta WhatsApp Business account with this text and submit it for approval. Once approved, Refresh numbers in WhatsApp Settings to sync it into My Meta templates." },
        ] },
        { type: "callout", tone: "warning", title: "Library templates are not pre-approved", text: "StabiFlow Library templates are starting points. They are NOT automatically approved by Meta and can't be sent to customers until you submit them in Meta and Meta approves them." },
        { type: "callout", tone: "note", text: "The library opens from the Templates tab once at least one template has been synced from Meta. If you see \"No templates synced yet\", connect WhatsApp and refresh first." },
      ],
    },
    {
      id: "intake",
      title: "D. Intake",
      keywords: ["intake form", "questions", "qualify", "schema", "fields", "required"],
      blocks: [
        { type: "p", text: "Intake is a set of questions StabiFlow can use to qualify new enquiries automatically - for example \"How much funding do you need?\". The answers appear under What we've learned in each conversation and help with lead qualification." },
        { type: "steps", steps: [
          { title: "Create a schema", detail: "A schema is one question set. You can have several, mark one as the default, and switch them on or off." },
          { title: "Add fields", detail: "For each field set a label, a type, whether it's required, the question the AI asks and optional help text. For choice questions, list the options separated by commas." },
          { title: "Order the questions", detail: "Use the up and down arrows." },
          { title: "Choose a set per number", detail: "Each WhatsApp number can use the workspace default or a specific question set." },
        ] },
        { type: "callout", tone: "tip", text: "Intake is optional. Without a schema, Messages keeps working normally." },
      ],
    },
    {
      id: "analytics",
      title: "E. Messages analytics",
      keywords: ["response time", "handoff rate", "resolution", "intake completion"],
      blocks: [
        { type: "p", text: "Messages analytics shows how your conversations are being handled: number of conversations, median human response time, handover rate, median resolution time, intake completion and the split between AI and human handling. Open it from the Analytics tab in Messages. The main Analytics page also shows how WhatsApp conversations convert into leads and customers." },
      ],
    },
    {
      id: "settings",
      title: "F. WhatsApp Settings",
      keywords: ["connection", "webhook", "repair", "refresh numbers", "sla", "business hours", "out of hours", "handover phrases", "voice notes", "attachments", "language", "ai limit"],
      blocks: [
        { type: "p", text: "Open settings with the gear icon on the Messages page. There are four areas:" },
        { type: "table", head: ["Area", "What you can do"], rows: [
          ["WhatsApp connection", "See your phone numbers and their health, check recent webhook activity, Subscribe/Repair the webhook if messages aren't arriving, Check connection, Refresh numbers (also re-syncs templates) and Disconnect."],
          ["Inbox & SLA", "Add your own handover phrases (up to 25, whole words, any letter case) and set a human response time target so late replies are flagged as overdue."],
          ["Business hours & replies", "Set opening hours, count the response target in business hours only, and send one automatic reply to customers who message outside business hours."],
          ["Inbox AI", "Let AI read customer attachments, transcribe voice notes, match the customer's language, and (owner only) set a monthly Inbox AI usage limit."],
        ] },
        { type: "callout", tone: "note", text: "Only workspace owners and admins can change these settings." },
      ],
    },
    {
      id: "permissions",
      title: "Who can use Messages",
      blocks: [{ type: "p", text: "Owners, admins, managers and the support role can view and work the inbox. Other roles don't see conversations." }],
    },
    {
      id: "troubleshooting",
      title: "Common problems",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "WhatsApp is connected but new messages aren't appearing",
            causes: ["The webhook subscription isn't active.", "The number is switched off for this workspace.", "The number has a health problem at Meta."],
            check: ["WhatsApp Settings > WhatsApp connection: look at webhook activity and number health.", "Integrations > WhatsApp > Manage: is the number ticked?"],
            fix: ["Choose Subscribe webhook or Repair subscription.", "Switch the number on, then Check connection."],
            contactSupport: "If repair doesn't help, contact support with your WhatsApp number and the time of a test message you sent.",
          },
          {
            symptom: "I can't send a normal reply",
            causes: ["The 24-hour messaging window has closed."],
            check: ["The window badge at the top of the chat."],
            fix: ["Send an approved template, or wait for the customer to message again."],
          },
          {
            symptom: "My templates are missing",
            causes: ["They haven't synced yet.", "They were created in a different WhatsApp Business account."],
            check: ["Templates shows \"No templates synced yet\"."],
            fix: ["WhatsApp Settings > Refresh numbers.", "Make sure the templates belong to the connected account."],
          },
        ] },
      ],
    },
  ],
};
