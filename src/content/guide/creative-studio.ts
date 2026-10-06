import { GROWTH, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const creativeStudio: GuideChapter = {
  slug: "creative-studio",
  number: 7,
  title: "Creative Studio",
  description: "Describe what you want to promote and get on-brand advert designs you can approve, edit, download or use in a campaign.",
  part: "Marketing",
  availability: GROWTH,
  appPath: "/app/creative-studio",
  updated: GUIDE_UPDATED,
  related: ["content", "campaigns", "my-business"],
  keywords: ["ads", "adverts", "design", "brand", "logo", "colours", "concepts", "visuals", "ai image", "layouts", "sizes", "approve", "reject", "copy ideas"],
  sections: [
    {
      id: "overview",
      title: "What Creative Studio does",
      blocks: [
        { type: "p", text: "Creative Studio produces ready-to-use advert images. You tell StabiFlow what you want to promote; it applies your saved brand - logo, colours and contact details - and generates several design concepts in the sizes you need." },
        { type: "screenshot", shot: { src: "creative-studio.webp", alt: "Creative Studio with the active brand and the Create your advert form" } },
        { type: "callout", tone: "note", text: "Creative Studio uses AI to write copy and create background visuals. Each generation counts towards your plan's monthly creative allowance, and you need a role that can create content." },
      ],
    },
    {
      id: "brand",
      title: "1. Choose your brand",
      keywords: ["brand profile", "brand kit", "logo", "colours", "default cta", "disclaimer"],
      blocks: [
        { type: "p", text: "At the top, select the brand to use. The active brand is shown with the note \"New adverts use this brand's saved identity and contact details.\" You can create or edit brands here, in My Business > Brand, or in Settings > Workspace > Brand Kit." },
        { type: "table", head: ["Brand field", "Used for"], rows: [
          ["Brand name and company name", "The brand's label and the company name on adverts."],
          ["Logo", "Placed on every advert."],
          ["Primary, secondary, accent and CTA text colours", "The advert colour scheme. Use hex codes like #1F2937."],
          ["Phone, WhatsApp, email, website, address", "Contact details you can choose to show on adverts."],
          ["Default CTA", "Fallback call to action, e.g. \"Get a free quote\". A campaign's own CTA always wins."],
          ["Footer / disclaimer", "Small print, if your industry needs it."],
        ] },
      ],
    },
    {
      id: "describe",
      title: "2. Describe your advert",
      keywords: ["offer", "audience", "tone", "headline", "cta", "visual direction", "reference image"],
      blocks: [
        { type: "steps", steps: [
          { title: "What do you want to create? (required)", detail: "For example: \"Create an advert promoting our same-day aircon servicing\"." },
          { title: "Main offer or message (optional)", detail: "For example: \"20% off for first-time bookings this month\"." },
          { title: "Customize (optional)", detail: "Open Customize to set target audience, tone, your own headline or CTA, supporting text and visual direction. Leave fields blank to let AI write them." },
          { title: "Reference image (optional)", detail: "Pick an image from your Media Library and say how to use it: as a reference creative, a product image or a background/source image." },
          { title: "Number of concepts and formats", detail: "Choose 1, 3 or 6 concepts and the sizes you need." },
          { title: "Contact details to show", detail: "Choose which of the brand's contact details appear on the adverts." },
        ] },
      ],
    },
    {
      id: "generate",
      title: "3. Generate your ads",
      blocks: [
        { type: "p", text: "Choose Generate Ads. StabiFlow creates the concepts, generates background visuals and renders finished adverts. Progress messages tell you how many succeeded; if a visual fails, you can retry just the failed ones." },
        { type: "table", head: ["Size", "Best for"], rows: [
          ["1080 x 1080 (square)", "Facebook and Instagram feeds."],
          ["1080 x 1350 (portrait)", "Instagram feed - takes up more of the screen."],
          ["1080 x 1920 (tall)", "Stories and full-screen placements."],
        ] },
      ],
    },
    {
      id: "review",
      title: "4. Review, edit and approve",
      keywords: ["approve", "reject", "edit text", "regenerate background", "download", "tight fit"],
      blocks: [
        { type: "p", text: "Each finished advert has these actions:" },
        { type: "list", items: [
          "Approve or Reject - mark which adverts you want to keep.",
          "Edit text - change the headline, body, CTA, contact line or price, then Update ad. The advert is re-rendered without generating a new image.",
          "Regenerate background - create a new AI background and re-render.",
          "Download - save the PNG.",
          "Use in Campaign - start a new Meta campaign with this advert (approved adverts only, and only if you can create campaigns).",
        ] },
        { type: "callout", tone: "tip", text: "A \"tight fit\" badge means the headline only just fits at that size. StabiFlow flags it rather than cutting words off - shorten the headline with Edit text." },
        { type: "p", text: "Rendered adverts are saved to your Media Library, so you can also use them in Content posts." },
      ],
    },
    {
      id: "advanced",
      title: "Advanced controls and copy ideas",
      blocks: [
        { type: "list", items: [
          "Advanced controls let you generate concepts one at a time, read each concept's visual prompt, choose a new AI visual or a Media Library image per concept, and pick layouts and sizes yourself.",
          "Layouts: Split (text left / visual right), Full bleed (image with readable overlay), Bold statement (oversized headline and CTA) and Professional card (image with a branded info panel). The one-click flow uses Professional card.",
          "Generate copy ideas creates wording ideas only (no images) - useful for brainstorming before you write your own headline.",
          "Recent generations appear at the top so you can reopen earlier work.",
        ] },
      ],
    },
    {
      id: "limitations",
      title: "Limitations to know",
      blocks: [
        { type: "list", items: [
          "AI generation needs an available creative allowance on your plan. When it runs out, generation stops until the next period or an upgrade.",
          "AI visuals can occasionally fail; retry failed visuals or choose a Media Library image instead.",
          "Always check AI-written wording and images for accuracy and suitability before publishing.",
        ] },
      ],
    },
  ],
};
