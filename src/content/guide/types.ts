// StabiFlow Guide content model.
//
// Chapters are plain data so the guide can be searched, printed and kept
// up to date without touching layout code. Every statement here must match
// current production behaviour - when a feature changes, update the chapter
// that describes it (search this folder for the feature name).

/** How a feature is offered. Shown as a badge; never exposes internal flag keys. */
export type Availability =
  | { kind: "everyone" }
  | { kind: "plan"; plans: string[] }
  | { kind: "role"; roles: string[] }
  | { kind: "admin" };

export type CalloutTone = "tip" | "important" | "warning" | "note";

export type GuideScreenshot = {
  /** File name under /help/screenshots/. */
  src: string;
  alt: string;
  caption?: string;
  /** Captured at phone width - rendered narrower. */
  mobile?: boolean;
};

export type GuideStep = { title: string; detail?: string };

export type GuideFaqItem = { q: string; a: string };

export type GuideTroubleshootItem = {
  symptom: string;
  causes: string[];
  check: string[];
  fix: string[];
  contactSupport?: string;
};

export type GuideWorkflowStage = { label: string; detail?: string; chapter?: string; section?: string };

export type GuideBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "steps"; steps: GuideStep[] }
  | { type: "callout"; tone: CalloutTone; title?: string; text: string }
  | { type: "screenshot"; shot: GuideScreenshot }
  | { type: "faq"; items: GuideFaqItem[] }
  | { type: "troubleshoot"; items: GuideTroubleshootItem[] }
  | { type: "workflow"; stages: GuideWorkflowStage[] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "checklist"; items: string[] };

export type GuideSection = {
  /** Anchor id, unique within its chapter: /app/guide/<chapter>#<id>. */
  id: string;
  title: string;
  blocks: GuideBlock[];
  /** Extra search terms that do not appear in the text. */
  keywords?: string[];
};

export type GuidePart = "Start here" | "Your business" | "Marketing" | "Customers" | "Automate & measure" | "Account" | "Reference";

export type GuideChapter = {
  slug: string;
  number: number;
  title: string;
  /** One-sentence promise shown under the title and in cards. */
  description: string;
  part: GuidePart;
  availability?: Availability;
  /** Product route this chapter documents, for the "Open ..." button. */
  appPath?: string;
  updated: string;
  sections: GuideSection[];
  related?: string[];
  keywords?: string[];
};
