import { GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const admin: GuideChapter = {
  slug: "admin",
  number: 20,
  title: "Customer app and Admin",
  description: "A short note for StabiFlow staff: the difference between the customer app and the separate Admin console.",
  part: "Reference",
  availability: { kind: "admin" },
  updated: GUIDE_UPDATED,
  related: ["settings", "troubleshooting"],
  keywords: ["admin", "operator", "staff", "console", "/admin", "platform"],
  sections: [
    {
      id: "two-surfaces",
      title: "Two separate surfaces",
      blocks: [
        { type: "table", head: ["", "Customer app", "Admin console"], rows: [
          ["Address", "/app", "/admin"],
          ["Who uses it", "Every business and its team.", "Authorised StabiFlow staff only."],
          ["What it's for", "Running your business: everything in this guide.", "Operating the StabiFlow platform."],
        ] },
        { type: "p", text: "Workspace roles such as Owner and Admin are about your own workspace. They are not the same as StabiFlow staff access, and they don't open the Admin console." },
      ],
    },
    {
      id: "access",
      title: "Opening Admin",
      blocks: [
        { type: "p", text: "If your account has staff access, an Admin console item appears in the menu under your avatar (top right). If you don't see it, your account doesn't have Admin access - that is normal for customers." },
        { type: "callout", tone: "note", text: "Admin access is granted by StabiFlow, never from workspace settings." },
      ],
    },
  ],
};
