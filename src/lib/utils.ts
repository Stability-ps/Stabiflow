import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design-system type scale (tailwind.config.ts fontSize) uses custom
// names; register them as font sizes so tailwind-merge doesn't mistake
// `text-metric` for a text colour and drop it next to `text-foreground`.
// Likewise the h-[var(--control-h)] control heights are ordinary h-* values.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["metric", "title-page", "title-section", "title-card", "label", "overline"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
