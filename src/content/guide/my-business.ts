import { EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const myBusiness: GuideChapter = {
  slug: "my-business",
  number: 5,
  title: "My Business",
  description: "The single, trusted record of your business: company details, About, brand, contacts, offerings, team and credentials.",
  part: "Your business",
  availability: EVERYONE,
  appPath: "/app/business",
  updated: GUIDE_UPDATED,
  related: ["business-studio", "documents", "creative-studio"],
  keywords: ["business profile", "company details", "brand", "logo", "contacts", "locations", "services", "products", "team", "social", "registration", "cipc", "vat", "bbbee", "certifications", "projects", "identifiers"],
  sections: [
    {
      id: "overview",
      title: "What My Business is",
      blocks: [
        { type: "p", text: "My Business keeps all your business facts in one place. Business Studio writes into this same record after you approve its suggestions, and StabiFlow reuses it for your profile documents, your public business page and your marketing." },
        { type: "screenshot", shot: { src: "my-business-overview.webp", alt: "My Business page with Profile setup progress, Complete with AI and expandable sections" } },
      ],
    },
    {
      id: "progress",
      title: "Profile setup progress",
      keywords: ["completeness", "continue setup", "percentage"],
      blocks: [
        { type: "p", text: "The Profile setup card shows how many essentials are complete and your overall score. Continue setup opens the first section that still needs attention." },
        { type: "p", text: "Each section shows Complete or Needs attention. Some sections can be marked as not applicable - for example \"We don't use social media\" or \"No public/physical location\" - so they stop counting against your score." },
      ],
    },
    {
      id: "complete-with-ai",
      title: "Complete with AI",
      keywords: ["ai", "scan", "suggestions", "draft"],
      blocks: [
        { type: "p", text: "Complete with AI scans your website (if you've entered one) for industry, contact details, locations, services, social links and other supported facts, then drafts your About wording. Everything appears as suggestions under the button for you to Accept, Correct or mark Not correct." },
        { type: "callout", tone: "note", text: "Facts added by a scan or AI show a small badge with their source until you confirm them, so you always know where a detail came from." },
        { type: "callout", tone: "important", text: "Complete with AI is included with the Business and Growth plans. On other plans the button is locked with a See plans link, and you can fill in every section yourself." },
      ],
    },
    {
      id: "sections",
      title: "The sections, one by one",
      blocks: [
        { type: "table", head: ["Section", "What to enter", "Tips"], rows: [
          ["Company", "Trading name, registered (legal) name, industry, website, year founded, team size, country.", "Use your registered name exactly as on your company documents."],
          ["About", "Tagline, short description, About the business, mission, vision, core values (comma separated).", "The short description is one or two sentences - it's used where space is tight."],
          ["Brand", "Choose or create a brand: logo and colours.", "This brand is also used by Creative Studio for adverts."],
          ["Contact & locations", "Email, phone, WhatsApp, fax or other contacts; business addresses.", "Tick Show on my public profile only for details customers should see. Mark one contact of each type as the main one."],
          ["Services & products", "Name, type, optional price text, description, and whether to feature it.", "Add at least three for a strong profile."],
          ["Social media", "Facebook, Instagram, LinkedIn, X, TikTok, YouTube or other links.", "Paste the full link, starting with https://."],
          ["Team", "Full name, role and short bio.", "Hide individuals from the public profile by unticking Show on my public profile."],
          ["Work & credentials", "Projects, certifications and accreditations, and registration numbers.", "Registration numbers are private unless you choose to show them."],
        ] },
      ],
    },
    {
      id: "identifiers",
      title: "Registration numbers",
      keywords: ["cipc", "vat", "tax", "b-bbee", "csd", "cidb"],
      blocks: [
        { type: "p", text: "For South African businesses, StabiFlow offers the common registration types: CIPC registration number, VAT number, income tax reference, B-BBEE level, CSD supplier number and CIDB grading. The options depend on the country set in the Company section." },
        { type: "callout", tone: "important", text: "Registration numbers are private by default. They only appear on your public profile if you tick Show on my public profile." },
      ],
    },
    {
      id: "public-profile",
      title: "Public profile and publishing",
      keywords: ["public url", "/b/", "hosted page", "publish"],
      blocks: [
        { type: "p", text: "My Business decides what information exists and what may be shown publicly. Publishing the actual web page happens in Documents > Hosted business profile, where you choose your link (/b/your-name) and publish it. See the Documents chapter." },
      ],
    },
    {
      id: "permissions",
      title: "Who can edit",
      blocks: [
        { type: "p", text: "Only workspace owners and admins can edit My Business. Everyone else sees the same information read-only." },
      ],
    },
    {
      id: "mistakes",
      title: "Common mistakes",
      blocks: [
        { type: "list", items: [
          "Leaving \"Show on my public profile\" ticked for a private mobile number.",
          "Adding fewer than three services or products - your profile looks thin and the score stays lower.",
          "Not linking a brand, so profiles and adverts fall back to plain colours.",
          "Changing details here and expecting an already-generated PDF to update. Generate a new PDF in Business Studio after changes.",
        ] },
      ],
    },
  ],
};
