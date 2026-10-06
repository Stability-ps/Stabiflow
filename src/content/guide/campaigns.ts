import { GROWTH, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const campaigns: GuideChapter = {
  slug: "campaigns",
  number: 9,
  title: "Campaigns",
  description: "Build Meta (Facebook and Instagram) advertising campaigns step by step, publish them safely and see what they bring in.",
  part: "Marketing",
  availability: GROWTH,
  appPath: "/app/campaigns",
  updated: GUIDE_UPDATED,
  related: ["creative-studio", "integrations", "analytics", "leads"],
  keywords: ["ads", "advertising", "meta ads", "facebook ads", "instagram ads", "budget", "audience", "objective", "publish", "pause", "resume", "roas", "attribution", "readiness"],
  sections: [
    {
      id: "overview",
      title: "Campaigns overview",
      blocks: [
        { type: "p", text: "Campaigns lets you create Meta adverts without leaving StabiFlow. Because StabiFlow also handles your WhatsApp conversations, leads and customers, it can show which campaigns actually produced conversations, leads, customers and revenue - not just clicks." },
        { type: "p", text: "The campaign list shows each campaign's status, objective and key figures. Use the ... menu to duplicate a campaign or delete a draft." },
        { type: "screenshot", shot: { src: "campaigns-list.webp", alt: "Campaigns list with statuses and the New campaign button" } },
        { type: "callout", tone: "important", text: "You need Meta connected with an Ad Account and a Facebook Page switched on (Integrations). Nothing is sent to Meta until you explicitly publish." },
      ],
    },
    {
      id: "builder",
      title: "Creating a campaign",
      keywords: ["new campaign", "goal", "objective", "ad account", "audience", "budget", "schedule", "creative", "review"],
      blocks: [
        { type: "p", text: "Choose New campaign. The builder has seven steps; use Next and Back to move between them." },
        { type: "steps", steps: [
          { title: "Goal", detail: "Name the campaign and choose an objective (see below)." },
          { title: "Ad Account", detail: "Pick the Meta Ad Account, the Facebook Page, an optional Instagram account and the destination: your website, WhatsApp, or your Facebook Page / Instagram profile." },
          { title: "Audience", detail: "Set the age range, gender and countries (two-letter codes such as ZA, NA)." },
          { title: "Budget & Schedule", detail: "Choose a daily or lifetime budget. Start immediately once readiness passes, or pick a date and time (in your workspace timezone). Optionally set an end date." },
          { title: "Creative", detail: "Choose an image from your Media Library and write the primary text, optional headline and description, and the call to action. For website destinations add the URL; for WhatsApp choose your connected number." },
          { title: "Review", detail: "Check the summary and save the draft. Anything missing is listed so you can go back and fix it." },
          { title: "Publish", detail: "StabiFlow runs a readiness check against Meta's requirements. When it passes, publish." },
        ] },
        { type: "screenshot", shot: { src: "campaign-new.webp", alt: "New campaign builder showing the Goal step" } },
      ],
    },
    {
      id: "objectives",
      title: "Choosing an objective",
      blocks: [
        { type: "table", head: ["Objective", "Use it to"], rows: [
          ["Awareness", "Show your ad to as many people as possible in your audience."],
          ["Traffic", "Send people to your website, or start a WhatsApp conversation."],
          ["Engagement", "Get more likes, comments and shares on your Page or Instagram profile."],
          ["Sales", "Drive people to your website to shop. Currently optimised for traffic - conversion tracking isn't set up yet."],
        ] },
        { type: "callout", tone: "tip", text: "If you want enquiries in WhatsApp, choose Traffic with the WhatsApp destination. Those conversations arrive in Messages and can be linked back to the campaign." },
      ],
    },
    {
      id: "statuses",
      title: "Campaign statuses",
      keywords: ["draft", "needs attention", "ready to publish", "publishing", "active", "paused", "completed", "failed", "partially published"],
      blocks: [
        { type: "table", head: ["Status", "Meaning"], rows: [
          ["Draft", "Saved in StabiFlow only."],
          ["Needs attention", "Something must be fixed before it can publish."],
          ["Ready to publish", "Readiness check passed."],
          ["Publishing", "Being created at Meta."],
          ["Active", "Running at Meta."],
          ["Paused", "Stopped by you; can be resumed."],
          ["Completed", "Reached its end date."],
          ["Failed", "Meta rejected it or publishing stopped - see the Activity tab."],
        ] },
        { type: "callout", tone: "warning", text: "\"Partially published\" means some parts were created at Meta before an error. Check the Activity tab for details before trying again." },
      ],
    },
    {
      id: "detail",
      title: "Campaign details and performance",
      keywords: ["overview", "creative", "journey", "performance", "activity", "refresh metrics", "insights"],
      blocks: [
        { type: "p", text: "Open a campaign to see five tabs:" },
        { type: "table", head: ["Tab", "What it shows"], rows: [
          ["Overview", "Objective, status, ad account, budget, schedule, audience, destination, Page and Instagram account."],
          ["Creative", "The image and copy the campaign runs, with an Edit creative link."],
          ["Journey", "How people moved from the ad to conversations, leads and customers."],
          ["Performance", "Daily spend, impressions, reach, clicks, CTR, CPC and results, plus conversions, attributed revenue and ROAS."],
          ["Activity", "A history of publishing and status changes."],
        ] },
        { type: "p", text: "Meta figures sync automatically every 30 minutes while a campaign is active. Use Pause and Resume to control delivery." },
        { type: "screenshot", shot: { src: "campaign-detail.webp", alt: "Campaign detail page with Overview, Creative, Journey, Performance and Activity tabs" } },
      ],
    },
    {
      id: "editing",
      title: "Editing a campaign",
      blocks: [
        { type: "p", text: "Use Edit schedule or Edit creative from the campaign page to reopen the builder at the right step. Some details can't be changed once a campaign is live at Meta; the builder tells you what is editable." },
      ],
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "My campaign isn't publishing",
            causes: ["The readiness check found missing or invalid details.", "No active Ad Account or Page.", "The Meta connection expired.", "The image doesn't meet Meta's requirements."],
            check: ["Open the campaign and read the readiness checklist.", "Check the Activity tab.", "Use Check connection in Integrations."],
            fix: ["Fix each listed item, then publish again.", "Reconnect Meta if the connection is unhealthy."],
            contactSupport: "If the campaign shows Partially published or Failed with a message you don't understand, contact support with the campaign name and the time you tried.",
          },
          {
            symptom: "No WhatsApp number to choose",
            causes: ["No active WhatsApp number is connected for this workspace."],
            check: ["Integrations > WhatsApp > Manage."],
            fix: ["Connect WhatsApp and switch a number on."],
          },
          {
            symptom: "Performance shows no data",
            causes: ["Meta hasn't started delivering yet.", "The campaign is paused or hasn't started."],
            check: ["Status and schedule on the Overview tab."],
            fix: ["Wait for delivery; figures update every 30 minutes."],
          },
        ] },
      ],
    },
  ],
};
