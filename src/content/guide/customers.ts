import { BUSINESS_AND_UP, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const customers: GuideChapter = {
  slug: "customers",
  number: 12,
  title: "Customers",
  description: "Everyone who became a customer, with their conversations, opportunities, revenue and history in one place (Customer 360).",
  part: "Customers",
  availability: BUSINESS_AND_UP,
  appPath: "/app/customers",
  updated: GUIDE_UPDATED,
  related: ["leads", "messages", "analytics"],
  keywords: ["customer 360", "client", "history", "revenue", "attribution", "journey", "lead vs customer"],
  sections: [
    {
      id: "lead-vs-customer",
      title: "Leads vs customers",
      blocks: [
        { type: "table", head: ["", "Lead", "Customer"], rows: [
          ["Who", "Someone interested who hasn't bought yet.", "Someone who has bought from you."],
          ["How it's created", "Manually, or from a WhatsApp conversation.", "Automatically, when an opportunity is marked won."],
          ["Where", "Leads", "Customers"],
        ] },
        { type: "callout", tone: "note", text: "You don't create customers by hand. Win an opportunity in Leads (or from a conversation) and the customer appears here." },
      ],
    },
    {
      id: "list",
      title: "The customer list",
      blocks: [
        { type: "p", text: "Customers lists every customer with their contact details, company, number of opportunities, revenue and last activity. Use the search box to find someone quickly." },
        { type: "screenshot", shot: { src: "customers.webp", alt: "Customers list with search and columns for contact, company, opportunities and revenue" } },
      ],
    },
    {
      id: "customer-360",
      title: "Customer 360",
      keywords: ["profile", "timeline", "conversations", "documents", "notes", "activity"],
      blocks: [
        { type: "p", text: "Open a customer to see Customer 360 - their complete history on one page, with Call, WhatsApp and Email shortcuts." },
        { type: "table", head: ["Section", "What it shows"], rows: [
          ["Identity", "Name, company, phone and email."],
          ["Revenue", "Revenue recorded for this customer. Different currencies are shown separately, never added together."],
          ["Attribution", "Which platform and method brought this customer in, if known."],
          ["Customer journey", "A timeline of everything that happened."],
          ["Conversations", "Linked WhatsApp conversations."],
          ["Leads", "Related leads, with Open lead links."],
          ["Opportunities", "Their deals, won and lost."],
          ["Documents", "Files shared along the way."],
          ["Notes and Activity", "Team notes and a log of actions."],
        ] },
        { type: "screenshot", shot: { src: "customer-360.webp", alt: "Customer 360 page showing identity, revenue, attribution and journey sections" } },
      ],
    },
    {
      id: "linking",
      title: "Linking conversations to customers",
      blocks: [
        { type: "p", text: "In a WhatsApp conversation, use Link customer to connect the chat to an existing customer (StabiFlow suggests likely matches). From there, Open Customer 360 takes you to their full profile." },
      ],
    },
    {
      id: "troubleshooting",
      title: "I don't see my customer",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "A customer is missing from the list",
            causes: ["Their opportunity hasn't been marked won.", "You're in a different workspace.", "Your role can't view customers."],
            check: ["Find the lead in Leads and look at its opportunities.", "Check the workspace name at the top."],
            fix: ["Mark the opportunity Won.", "Switch to the correct workspace."],
          },
        ] },
      ],
    },
  ],
};
