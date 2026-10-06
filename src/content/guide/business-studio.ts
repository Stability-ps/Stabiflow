import { EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const businessStudio: GuideChapter = {
  slug: "business-studio",
  number: 4,
  title: "Business Studio",
  description: "Turn your website - or your own details - into a checked, professional company profile PDF.",
  part: "Your business",
  availability: EVERYONE,
  appPath: "/app/business-studio",
  updated: GUIDE_UPDATED,
  related: ["my-business", "documents", "billing"],
  keywords: ["company profile", "profile builder", "website scan", "pdf", "ai wording", "design", "template", "watermark", "create business profile"],
  sections: [
    {
      id: "overview",
      title: "What Business Studio does",
      blocks: [
        { type: "p", text: "Business Studio is a guided profile builder. It collects the facts about your business, helps you word them well, and produces a professional A4 company profile PDF in a design of your choice." },
        { type: "p", text: "Its golden rule: you check every fact before it is used. StabiFlow never invents details about your business - it quotes what it found and waits for your approval." },
        { type: "screenshot", shot: { src: "business-studio-overview.webp", alt: "Business Studio start step with the six-step progress bar and the From my website tab", caption: "Business Studio walks you through six steps." } },
      ],
    },
    {
      id: "steps",
      title: "The six steps",
      blocks: [
        { type: "workflow", stages: [
          { label: "1. Start", detail: "Scan your website, start from scratch, or paste an existing profile.", section: "start" },
          { label: "2. Review", detail: "Accept, correct or reject what was found.", section: "review" },
          { label: "3. Fill the gaps", detail: "See your completeness score and add what's missing.", section: "fill-gaps" },
          { label: "4. Wording", detail: "Optionally let AI polish your own wording.", section: "wording" },
          { label: "5. Design", detail: "Choose a profile design.", section: "design" },
          { label: "6. Preview & download", detail: "Preview, then create your PDF.", section: "preview" },
        ] },
        { type: "p", text: "You can jump between steps at any time using the numbered buttons at the top." },
      ],
    },
    {
      id: "start",
      title: "Step 1 - Start",
      keywords: ["scan my website", "no website", "start from scratch", "paste profile", "existing profile"],
      blocks: [
        { type: "p", text: "Choose how you want to begin:" },
        { type: "table", head: ["Option", "When to use it", "What happens"], rows: [
          ["From my website", "You have a business website.", "Enter the address and choose Scan my website. StabiFlow reads a few public pages (such as About, Services and Contact). It can take up to a minute."],
          ["Start from scratch", "You don't have a website.", "Skip straight to filling in your details yourself, guided by what a strong profile needs."],
          ["Existing profile", "You already have a profile in Word or PDF.", "Paste its text (at least a few sentences) and choose Read my profile. This uses 1 AI credit."],
        ] },
        { type: "callout", tone: "note", title: "No website?", text: "Business Studio works perfectly well without one. Choose Start from scratch and enter your details - you can always scan a website later." },
        { type: "callout", tone: "important", title: "Plans", text: "Scanning a website, reading an existing profile and AI wording are included with the Business and Growth plans (with a monthly allowance of scans and AI credits). On Free and the once-off Professional Profile these buttons are locked with a See plans link - you can still enter your details yourself and preview your profile." },
      ],
    },
    {
      id: "review",
      title: "Step 2 - Review what was found",
      keywords: ["accept", "correct", "not correct", "proposals", "suggestions"],
      blocks: [
        { type: "p", text: "Every fact StabiFlow found is shown as a suggestion, labelled with where it came from (for example \"Found on your website\" or \"From your existing profile\"). Facts read by AI are quoted from your site so you can see the evidence." },
        { type: "steps", steps: [
          { title: "Accept", detail: "The fact is right - it's added to your business details." },
          { title: "Correct", detail: "It's nearly right - edit it, then choose Save and accept." },
          { title: "Not correct", detail: "It isn't about your business - it's discarded." },
        ] },
        { type: "p", text: "When there are several contact and listing details, you can use Accept all to accept them in one go. Choose Continue when you're done; the button shows how many suggestions are left." },
      ],
    },
    {
      id: "fill-gaps",
      title: "Step 3 - Fill the gaps",
      keywords: ["completeness", "percentage", "missing", "legal name", "industry", "mission", "vision"],
      blocks: [
        { type: "p", text: "This step shows how complete your profile is as a percentage, with a tick list of the essentials. You can complete the core fields here - registered name, industry, website, short description, About the business, mission and vision - and choose Save & stay in Studio." },
        { type: "p", text: "For contact details, locations, services, team, projects and registrations, choose More details to open My Business, then return to the Studio." },
        { type: "callout", tone: "important", text: "\"We never make these up for you.\" If a detail is missing, add it yourself - StabiFlow won't fill gaps with invented information." },
      ],
    },
    {
      id: "wording",
      title: "Step 4 - Improve the wording (optional)",
      keywords: ["ai", "tone", "professional", "friendly", "confident", "formal", "rewrite"],
      blocks: [
        { type: "p", text: "Pick a tone - Professional, Friendly, Confident or Formal - and choose Suggest better wording. AI polishes your own description, tagline, mission and vision. It won't add new facts, and every change is shown as a suggestion you approve or reject." },
        { type: "callout", tone: "note", text: "Each wording request uses 1 AI credit. If your allowance is used up, StabiFlow tells you and points you to plans with more allowance." },
      ],
    },
    {
      id: "design",
      title: "Step 5 - Choose a design",
      keywords: ["template", "classic", "modern", "executive", "premium"],
      blocks: [
        { type: "table", head: ["Design", "Style", "Availability"], rows: [
          ["Classic", "Clean, traditional layout with a coloured header band.", "All plans"],
          ["Modern", "Bold cover with a side accent bar.", "Paid (Professional Profile or a subscription)"],
          ["Executive", "Minimal, generous whitespace, accent rules.", "Paid (Professional Profile or a subscription)"],
        ] },
      ],
    },
    {
      id: "preview",
      title: "Step 6 - Preview and download",
      keywords: ["pdf", "download", "watermark", "teaser", "buy profile", "documents"],
      blocks: [
        { type: "p", text: "You'll see a live preview of your profile in the chosen design." },
        { type: "list", items: [
          "If your plan includes clean PDFs, choose Create my PDF. The finished profile opens in a new tab and is saved to Documents.",
          "On the Free plan you see a protected preview. To get the clean PDF, buy the once-off Professional Profile or choose a subscription. The clean PDF is generated securely after purchase.",
          "Use My documents to see everything you've generated.",
        ] },
        { type: "screenshot", shot: { src: "business-studio-preview.webp", alt: "Business Studio preview step with the company profile preview and Get your company profile card" } },
      ],
    },
    {
      id: "why",
      title: "Why completing Business Studio matters",
      blocks: [
        { type: "p", text: "Business Studio and My Business share the same business record. Once your facts are complete and correct, StabiFlow reuses them in:" },
        { type: "list", items: [
          "Your company profile PDFs (Documents).",
          "Your hosted public business page at /b/your-name, if you publish one.",
          "AI-written post captions in Content, which use your My Business profile and services.",
          "Your workspace settings - website, industry, business description and main contact details are kept in step.",
        ] },
        { type: "callout", tone: "tip", text: "Your logo and colours for adverts come from the brand you link in My Business > Brand (also managed from Creative Studio and Settings > Workspace > Brand Kit)." },
      ],
    },
    {
      id: "permissions",
      title: "Who can use it",
      blocks: [
        { type: "p", text: "Business Studio is available on every plan; the website scan, existing-profile reading and AI wording need the Business or Growth plan. Only workspace owners and admins can build or change the profile; other roles can view the preview. Buying the Professional Profile requires billing permission (the owner)." },
      ],
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "The website scan found very little",
            causes: ["The site is mostly images, or loads its text with scripts.", "Key pages (About, Contact) are hard to find from the home page."],
            check: ["Open your website and see whether the text can be selected and copied."],
            fix: ["Use Existing profile and paste text from your current profile.", "Or fill in the details yourself in Step 3 and My Business."],
          },
          {
            symptom: "I can't click Scan, Read or Suggest",
            causes: ["Your plan doesn't include these tools (Free or Professional Profile).", "You are not a workspace owner or admin.", "Your scan or AI allowance for the month is used up."],
            check: ["Look for the message \"Only workspace owners and admins can build the company profile\".", "Check Billing & plans for your allowance."],
            fix: ["Ask the owner to give you the Admin role, or to make the changes.", "Upgrade for more allowance."],
          },
          {
            symptom: "My PDF has a watermark",
            causes: ["You generated it on the Free plan (a preview)."],
            check: ["In Documents, the badge says Preview rather than Final PDF."],
            fix: ["Buy the Professional Profile or a subscription, then create the PDF again."],
          },
        ] },
      ],
    },
  ],
};
