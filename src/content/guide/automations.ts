import { GROWTH, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const automations: GuideChapter = {
  slug: "automations",
  number: 13,
  title: "Automations",
  description: "When something happens in StabiFlow, automatically take the next step - with the same rules and permissions as doing it yourself.",
  part: "Automate & measure",
  availability: GROWTH,
  appPath: "/app/automations",
  updated: GUIDE_UPDATED,
  related: ["messages", "leads", "troubleshooting"],
  keywords: ["workflow", "trigger", "conditions", "actions", "when if then", "run history", "enable", "disable", "loop", "automatic"],
  sections: [
    {
      id: "model",
      title: "How automations work",
      blocks: [
        { type: "p", text: "Every automation follows the same pattern: WHEN a trigger event happens, IF the conditions match, THEN run one or more actions." },
        { type: "workflow", stages: [
          { label: "Trigger", detail: "Something happens, e.g. a lead is qualified." },
          { label: "Conditions", detail: "Optional checks, e.g. only for a certain stage." },
          { label: "Actions", detail: "What StabiFlow does, e.g. notify the team." },
          { label: "Enable", detail: "Switch it on." },
          { label: "Run history", detail: "See every time it ran." },
        ] },
        { type: "screenshot", shot: { src: "automations.webp", alt: "Automations list with triggers and statuses" } },
      ],
    },
    {
      id: "create",
      title: "Creating an automation",
      blocks: [
        { type: "steps", steps: [
          { title: "Start", detail: "Choose New automation, or start from an example such as \"New conversation creates a lead\", \"Qualified leads notify the team\" or \"Published content notifies the team\"." },
          { title: "Name it", detail: "Use a clear name, e.g. \"Notify sales on new lead\"." },
          { title: "When - choose the trigger", detail: "Pick the event. For \"gone quiet\" triggers, set how many minutes of inactivity count." },
          { title: "If - add conditions (optional)", detail: "Each condition compares a field (for example qualification_status) with a value. With no conditions, the automation runs on every matching event." },
          { title: "Then - add actions", detail: "Add at least one action and fill in its settings." },
          { title: "Save and enable", detail: "Save the automation, then enable it from the list." },
        ] },
        { type: "screenshot", shot: { src: "automation-builder.webp", alt: "Automation builder with When, If and Then sections" } },
      ],
    },
    {
      id: "triggers",
      title: "Available triggers",
      blocks: [
        { type: "table", head: ["Area", "Triggers"], rows: [
          ["WhatsApp conversations", "A conversation starts; a message is received; a conversation is handed to a human; a team member takes over; AI is paused; a conversation is returned to AI; a conversation is closed; intake is completed; a handover is overdue; a customer sends a document or image; a conversation goes quiet; priority changes; Inbox AI usage limit reached; an outbound message can't be delivered."],
          ["Leads", "A lead is created; qualified; moves stage; goes idle; a follow-up is scheduled; a follow-up is completed."],
          ["Opportunities & customers", "An opportunity is created, moves stage, is won or is lost; a customer is created; revenue is recorded."],
          ["Content & campaigns", "A post is published or fails; a campaign is published, paused, or its performance changes."],
          ["Insights", "A new attribution touchpoint is recorded; a Flow AI analysis completes."],
        ] },
      ],
    },
    {
      id: "actions",
      title: "Available actions",
      blocks: [
        { type: "list", items: [
          "Create a lead; assign the lead; move the lead to a pipeline stage.",
          "Create an opportunity; assign the opportunity.",
          "Add an internal note; send an in-app notification (appears under the bell icon).",
          "Ask Flow AI to analyse this.",
          "Set the conversation priority; hand the conversation to a human; assign the conversation; pause AI; return the conversation to AI; add a tag.",
          "Send a WhatsApp template; ask the customer for a document.",
        ] },
        { type: "callout", tone: "important", text: "Automations that message customers must use approved WhatsApp templates when the 24-hour window is closed - the same rule as sending by hand." },
      ],
    },
    {
      id: "managing",
      title: "Enabling, editing and run history",
      keywords: ["enable", "disable", "edit", "delete", "runs", "history", "failed"],
      blocks: [
        { type: "list", items: [
          "Enable or disable an automation from the list at any time.",
          "Use the ... menu to View run history, Edit or Delete.",
          "Run history shows the last 50 times the automation matched a trigger, newest first, with each step's result. \"No steps recorded\" means the conditions weren't met or the run hasn't started.",
        ] },
        { type: "callout", tone: "tip", text: "There's no separate test button. To test safely, enable the automation and trigger it with a real but harmless event - for example create a test lead - then check run history. Disable or delete it afterwards if it was only a test." },
      ],
    },
    {
      id: "safety",
      title: "Safety and loop protection",
      keywords: ["loop", "chain", "depth", "permissions"],
      blocks: [
        { type: "list", items: [
          "Automations act with the same rules and permissions as a person doing the same thing.",
          "An automation never re-triggers itself from its own action.",
          "Chains of automations triggering each other stop after five steps, so a mistake can't run forever.",
          "Failed automations appear in Home > Needs attention.",
        ] },
      ],
    },
    {
      id: "plans",
      title: "Plans and run allowances",
      blocks: [
        { type: "p", text: "Automations are part of the Growth plan. Each plan includes a monthly number of automation runs; check Billing & plans for your allowance. On other plans, the Automations page shows \"Automations are a Growth feature\" with a link to plans." },
        { type: "p", text: "Owners, admins and managers can create, edit, enable and delete automations. Other roles can view automations and their run history." },
      ],
    },
  ],
};
