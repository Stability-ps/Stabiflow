import { BUSINESS_AND_UP, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const content: GuideChapter = {
  slug: "content",
  number: 8,
  title: "Content",
  description: "Store your images, write posts with AI help, and schedule or publish them to your Facebook Page and Instagram.",
  part: "Marketing",
  availability: BUSINESS_AND_UP,
  appPath: "/app/content",
  updated: GUIDE_UPDATED,
  related: ["creative-studio", "integrations", "campaigns"],
  keywords: ["posts", "social media", "facebook", "instagram", "schedule", "publish", "calendar", "drafts", "media library", "upload", "caption", "variants", "linkedin"],
  sections: [
    {
      id: "overview",
      title: "What Content does",
      blocks: [
        { type: "p", text: "Content is where your social posts live. Upload images once, write a caption (or let AI suggest one), then publish now or schedule for later. Content has five tabs: Media Library, Calendar, Scheduled, Published and Drafts." },
        { type: "workflow", stages: [
          { label: "Upload or create", detail: "Add an image to the Media Library, or render one in Creative Studio.", section: "media-library" },
          { label: "Write the post", detail: "Pick a destination, image and caption.", section: "new-post" },
          { label: "Schedule or publish", detail: "Publish now or pick a date and time.", section: "new-post" },
          { label: "Review", detail: "Follow it in Scheduled, Calendar and Published.", section: "tracking" },
        ] },
        { type: "callout", tone: "important", text: "Posting goes to Facebook Pages and Instagram accounts connected through Meta in Integrations. LinkedIn is not supported yet." },
      ],
    },
    {
      id: "media-library",
      title: "Media Library",
      keywords: ["upload", "jpeg", "png", "variants", "archive", "image requirements"],
      blocks: [
        { type: "p", text: "The Media Library holds your original images and their Facebook/Instagram versions. Anything uploaded here can be reused in posts, Creative Studio and Campaigns." },
        { type: "steps", steps: [
          { title: "Upload media", detail: "Choose a JPEG or PNG image up to 15 MB. Give it a title and, optionally, a default caption used when no caption is entered at posting time." },
          { title: "Check requirements", detail: "Each image shows whether it meets each platform's size and shape rules." },
          { title: "Generate platform variants", detail: "StabiFlow can create correctly sized versions automatically. If the shape is too different to convert safely, it tells you which platforms need a manual adjustment." },
        ] },
        { type: "callout", tone: "tip", text: "Uploading a file that's already in the library is detected - StabiFlow offers to use the existing asset instead of storing a duplicate." },
        { type: "screenshot", shot: { src: "content-media-library.webp", alt: "Content Media Library with uploaded images and platform status" } },
      ],
    },
    {
      id: "new-post",
      title: "Creating a post",
      keywords: ["new post", "caption", "ai caption", "tone", "publish now", "schedule"],
      blocks: [
        { type: "steps", steps: [
          { title: "Choose the destination", detail: "Pick a connected Facebook Page or Instagram account." },
          { title: "Choose the media", detail: "Select an image from the Media Library. If it doesn't meet that platform's rules yet, StabiFlow lists what's wrong." },
          { title: "Write the caption", detail: "Type your own, or pick a tone (Professional, Friendly, Confident or Playful) and let AI draft one using the image and your My Business profile and services. Always review it." },
          { title: "Choose when", detail: "Publish now, or Schedule for a date and time in your workspace timezone." },
        ] },
        { type: "table", head: ["Platform", "Image rules"], rows: [
          ["Facebook Feed", "JPEG/PNG, at least 600 x 315 px, aspect ratio between 1:2 and 1.91:1, max 8 MB."],
          ["Instagram Feed", "JPEG/PNG, at least 320 x 320 px, aspect ratio between 4:5 and 1.91:1, max 8 MB, caption up to 2,200 characters."],
        ] },
      ],
    },
    {
      id: "tracking",
      title: "Calendar, Scheduled, Published and Drafts",
      keywords: ["failed post", "retry", "reschedule", "cancel", "duplicate", "draft"],
      blocks: [
        { type: "table", head: ["Tab", "Shows", "What you can do"], rows: [
          ["Calendar", "Scheduled, published and failed posts by day.", "See your posting rhythm at a glance."],
          ["Scheduled", "Posts queued to publish, plus any that failed.", "Publish now, reschedule, cancel, retry a failed post, or duplicate."],
          ["Published", "Posts that have gone live.", "Duplicate a post to reuse it."],
          ["Drafts", "Posts saved but not scheduled.", "Duplicating a post creates a draft you can schedule later."],
        ] },
        { type: "callout", tone: "warning", text: "A failed post shows the reason next to it (for example an expired Meta connection). Fix the cause first, then use retry - otherwise it will fail again." },
      ],
    },
    {
      id: "permissions",
      title: "Who can do what",
      blocks: [{ type: "p", text: "Owners, admins, managers and the marketing role can create, edit, publish and delete content. Sales, support and viewers can see content but not change it." }],
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "No destinations to choose from",
            causes: ["Meta isn't connected, or no Facebook Page / Instagram account is switched on for this workspace."],
            check: ["Open Integrations and look at the Meta card."],
            fix: ["Connect Meta, then use Manage to enable at least one Page or Instagram account."],
          },
          {
            symptom: "My post failed",
            causes: ["Meta connection expired or lost permission.", "The image no longer meets the platform rules.", "Meta rejected the content."],
            check: ["Read the failure reason in Scheduled.", "Use Check connection in Integrations > Meta > Manage."],
            fix: ["Reconnect Meta if needed, then retry the post."],
          },
        ] },
      ],
    },
  ],
};
