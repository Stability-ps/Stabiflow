import { EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const documents: GuideChapter = {
  slug: "documents",
  number: 6,
  title: "Documents",
  description: "Your generated company profiles, and the hosted business page customers can visit at /b/your-name.",
  part: "Your business",
  availability: EVERYONE,
  appPath: "/app/documents",
  updated: GUIDE_UPDATED,
  related: ["business-studio", "my-business", "billing"],
  keywords: ["pdf", "download", "company profile", "hosted profile", "public page", "qr code", "slug", "publish", "unpublish", "preview", "final pdf"],
  sections: [
    {
      id: "overview",
      title: "What Documents holds",
      blocks: [
        { type: "p", text: "Documents is your business library. It lists every company profile you've generated in Business Studio, and it's where you publish your hosted business profile - a public web page for your business." },
        { type: "screenshot", shot: { src: "documents-overview.webp", alt: "Documents page listing generated profiles and the Hosted business profile card" } },
      ],
    },
    {
      id: "creating",
      title: "Creating a document",
      blocks: [
        { type: "p", text: "Documents are created in Business Studio. Choose Create document (top right) to go there. Today the document type is the company profile PDF, in the Classic, Modern or Executive design." },
      ],
    },
    {
      id: "list",
      title: "Your document list",
      keywords: ["final", "preview", "watermarked", "pages"],
      blocks: [
        { type: "p", text: "Each document shows its title, design, the date it was generated and how many pages it has. A badge tells you which kind it is:" },
        { type: "table", head: ["Badge", "Meaning"], rows: [
          ["Final PDF", "A clean, professional PDF you can send to customers."],
          ["Preview", "A watermarked preview created before purchase."],
        ] },
        { type: "list", items: [
          "Preview opens the document in a new tab.",
          "Download saves the PDF.",
          "The ... menu lets you open the document or copy its name.",
        ] },
        { type: "callout", tone: "note", text: "Documents are snapshots. If you change My Business afterwards, create a new PDF in Business Studio - older PDFs don't change." },
      ],
    },
    {
      id: "hosted-profile",
      title: "Hosted business profile (your public page)",
      keywords: ["public profile", "/b/", "slug", "link", "qr", "publish", "enquiry", "whatsapp button"],
      blocks: [
        { type: "p", text: "The hosted business profile is a web page that shows your business, services, credentials and contact details, with an optional profile download. It is only published when you choose." },
        { type: "steps", steps: [
          { title: "Choose your link", detail: "Under Your link, enter the part after /b/ - for example acme-plumbing. Use 3 to 60 lowercase letters, numbers and dashes." },
          { title: "Choose a downloadable profile (optional)", detail: "Pick one of your Final PDFs so visitors can download it, or None." },
          { title: "Decide on contact buttons", detail: "Tick Show Contact us / WhatsApp buttons to let visitors get in touch directly." },
          { title: "Publish", detail: "Choose Publish profile. You can also Save draft first." },
          { title: "Share it", detail: "Once live, copy the link, open it, or download a QR code for flyers, business cards and signage." },
        ] },
        { type: "callout", tone: "important", text: "Publishing the hosted profile is included with the Business and Growth plans. On other plans you can save a draft, and the card links you to Billing & plans." },
        { type: "p", text: "To take the page down, choose Unpublish. Your settings are kept so you can publish again later." },
        { type: "screenshot", shot: { src: "documents-hosted-profile.webp", alt: "Hosted business profile card with link, document choice and publish controls" } },
      ],
    },
    {
      id: "public-page",
      title: "What visitors see",
      blocks: [
        { type: "p", text: "Your public page (app.stabiflow.com/b/your-name) shows your name and description, About us, What we do (or Our products), Projects, Our team, Credentials and Contact - using only details marked to show on your public profile. If a link doesn't exist or isn't published, visitors see \"Profile not found\"." },
      ],
    },
    {
      id: "permissions",
      title: "Who can publish",
      blocks: [{ type: "p", text: "Anyone in the workspace can view and download documents. Only owners and admins can publish, update or unpublish the hosted profile." }],
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "Publish profile is greyed out",
            causes: ["Your plan doesn't include hosted profiles.", "The link isn't valid.", "You're not an owner or admin."],
            check: ["Look for the message about Business and Growth plans.", "Check for the red hint under Your link."],
            fix: ["Upgrade in Billing & plans.", "Use only lowercase letters, numbers and dashes (3-60 characters).", "Ask an owner or admin to publish."],
          },
          {
            symptom: "My PDF doesn't appear in the downloadable profile list",
            causes: ["Only Final PDFs can be offered for download - previews are excluded."],
            check: ["In the document list, check for the Final PDF badge."],
            fix: ["Create a clean PDF in Business Studio after purchasing."],
          },
          {
            symptom: "A detail is missing from my public page",
            causes: ["It isn't ticked to show on your public profile in My Business."],
            check: ["Open My Business and find the item."],
            fix: ["Tick Show on my public profile and save."],
          },
        ] },
      ],
    },
  ],
};
