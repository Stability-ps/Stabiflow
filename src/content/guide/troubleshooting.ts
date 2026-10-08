import { EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

const SUPPORT = "Contact support at contact@stabiflow.com with your workspace name, what you were trying to do and roughly when it happened. Never send passwords or card details.";

export const troubleshooting: GuideChapter = {
  slug: "troubleshooting",
  number: 22,
  title: "Troubleshooting",
  description: "Find your problem by what you're seeing, then follow the cause, the check and the fix.",
  part: "Reference",
  availability: EVERYONE,
  updated: GUIDE_UPDATED,
  related: ["faq", "integrations", "messages"],
  keywords: ["problem", "error", "not working", "missing", "broken", "help", "fix", "issue"],
  sections: [
    {
      id: "access",
      title: "Access and visibility",
      keywords: ["can't see module", "missing menu", "locked", "not available"],
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "I can't see a module in the menu",
            causes: ["Your plan doesn't include it.", "Your role doesn't allow it.", "You're in a different workspace.", "The module isn't switched on for your workspace yet."],
            check: ["Billing & plans shows your plan and what it includes.", "Settings > Members shows your role.", "The workspace name at the top of the screen."],
            fix: ["Upgrade, or ask the owner to.", "Ask an admin for a role that includes the area.", "Switch to the right workspace."],
            contactSupport: SUPPORT,
          },
          {
            symptom: "I can't access Admin",
            causes: ["Admin is only for StabiFlow staff. Workspace Owner and Admin roles don't include it."],
            check: ["Look for Admin console in the menu under your avatar."],
            fix: ["Nothing to fix if you're a customer - everything you need is in the customer app."],
          },
          {
            symptom: "Buttons are greyed out",
            causes: ["Your role can view but not change this area.", "A required step isn't done yet (for example nothing selected)."],
            check: ["Hover over the button - many show the reason."],
            fix: ["Ask an owner or admin, or complete the missing step."],
          },
        ] },
      ],
    },
    {
      id: "whatsapp",
      title: "WhatsApp",
      keywords: ["templates missing", "messages not appearing", "can't reply", "template required"],
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "My WhatsApp templates are missing",
            causes: ["Templates haven't been synced yet.", "They belong to a different WhatsApp Business account.", "They were created after the last sync."],
            check: ["Messages > Templates shows the synced count."],
            fix: ["Open WhatsApp Settings and choose Refresh numbers - this also re-syncs templates."],
            contactSupport: SUPPORT,
          },
          {
            symptom: "WhatsApp is connected but messages aren't appearing",
            causes: ["The webhook subscription is inactive.", "The number is switched off for this workspace.", "Meta reports a problem with the number."],
            check: ["WhatsApp Settings > WhatsApp connection: recent webhook activity and number health."],
            fix: ["Choose Subscribe webhook or Repair subscription.", "Enable the number in Integrations > WhatsApp > Manage, then Check connection."],
            contactSupport: SUPPORT,
          },
          {
            symptom: "Why can't I send a normal WhatsApp message?",
            causes: ["The customer last messaged more than 24 hours ago, so WhatsApp's messaging window has closed."],
            check: ["The window badge at the top of the conversation."],
            fix: ["Send an approved template, or wait for the customer to reply."],
          },
          {
            symptom: "Why is a template required?",
            causes: ["WhatsApp only allows businesses to start or restart a conversation with a Meta-approved template. This protects customers from spam."],
            check: ["Messages > Templates > My Meta templates for APPROVED templates."],
            fix: ["Create a template (the StabiFlow Library can help with the wording), submit it in Meta and sync it once approved."],
          },
          {
            symptom: "AI isn't responding to customers",
            causes: ["The conversation is with a human (taken over) or AI is paused.", "The monthly Inbox AI limit has been reached.", "The conversation is closed."],
            check: ["The handover badge on the conversation.", "Home > Needs attention for \"Inbox AI paused\"."],
            fix: ["Choose Return to automation if a person no longer needs to handle it.", "Ask the owner to review the Inbox AI limit or plan."],
          },
        ] },
      ],
    },
    {
      id: "marketing",
      title: "Content and campaigns",
      keywords: ["campaign not publishing", "post not posting", "failed"],
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "My campaign isn't publishing",
            causes: ["Readiness check failed.", "No active Ad Account or Page.", "Meta connection expired.", "Image doesn't meet Meta's requirements."],
            check: ["The campaign's readiness checklist and Activity tab.", "Integrations > Meta > Manage > Check connection."],
            fix: ["Fix each listed item and publish again.", "Reconnect Meta."],
            contactSupport: SUPPORT,
          },
          {
            symptom: "My content isn't posting",
            causes: ["Meta connection expired or the Page/Instagram account was switched off.", "The image doesn't meet the platform rules.", "The post was scheduled in the wrong timezone."],
            check: ["Content > Scheduled shows failures with the reason.", "Settings > Workspace > Timezone."],
            fix: ["Reconnect or re-enable the destination, then retry.", "Correct the timezone and reschedule."],
          },
        ] },
      ],
    },
    {
      id: "billing",
      title: "Billing",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "My payment succeeded but my plan didn't change",
            causes: ["Paystack is still confirming.", "The payment needs a manual check.", "The page needs refreshing."],
            check: ["The message shown on Billing & plans.", "Payment history."],
            fix: ["Wait a few minutes and refresh."],
            contactSupport: SUPPORT,
          },
        ] },
      ],
    },
    {
      id: "crm",
      title: "Leads, customers and automations",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "I don't see my customer",
            causes: ["The opportunity hasn't been marked Won.", "You're in a different workspace.", "Your role can't view customers."],
            check: ["The lead's opportunities in Leads."],
            fix: ["Mark the opportunity Won, or switch workspace."],
          },
          {
            symptom: "My automation didn't run",
            causes: ["It's disabled.", "The conditions didn't match.", "The plan's automation runs are used up.", "Loop protection stopped a chain of automations.", "An action failed (for example the 24-hour window was closed)."],
            check: ["The automation's status.", "View run history - \"No steps recorded\" means conditions weren't met.", "Home > Needs attention for failed automations."],
            fix: ["Enable it.", "Loosen or correct the conditions (check field names and values).", "Use templates for messages outside the 24-hour window."],
          },
        ] },
      ],
    },
    {
      id: "business",
      title: "Business information",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "Business information is missing (on my profile, PDF or public page)",
            causes: ["The detail was never added or accepted.", "It isn't ticked to show on your public profile.", "The PDF was generated before you added it."],
            check: ["My Business - section status and the Show on my public profile ticks.", "Business Studio > Review for suggestions waiting."],
            fix: ["Add or accept the detail, then generate a new PDF.", "Tick Show on my public profile."],
          },
        ] },
      ],
    },
    {
      id: "contact",
      title: "Still stuck?",
      blocks: [
        { type: "p", text: SUPPORT },
      ],
    },
  ],
};
