// Creative Studio batch image ads - the fixed rendering vocabulary.
// V1 is deliberately closed: 4 layouts x 3 Meta sizes, no editor, no
// arbitrary canvas (instruction #8/#9/#26).

export const AD_LAYOUTS = ["split", "full_bleed", "bold_statement", "professional_card"] as const;
export type AdLayoutKind = (typeof AD_LAYOUTS)[number];

export const AD_LAYOUT_LABELS: Record<AdLayoutKind, string> = {
  split: "Split (text left / visual right)",
  full_bleed: "Full bleed (image + readable overlay)",
  bold_statement: "Bold statement (oversized headline + CTA)",
  professional_card: "Professional card (image + branded info panel)",
};

export const AD_SIZES = ["1080x1080", "1080x1350", "1080x1920"] as const;
export type AdSizeKind = (typeof AD_SIZES)[number];

export const AD_SIZE_DIMENSIONS: Record<AdSizeKind, { width: number; height: number }> = {
  "1080x1080": { width: 1080, height: 1080 },
  "1080x1350": { width: 1080, height: 1350 },
  "1080x1920": { width: 1080, height: 1920 },
};

export const AD_SIZE_LABELS: Record<AdSizeKind, string> = {
  "1080x1080": "Square 1:1 (feed)",
  "1080x1350": "Portrait 4:5 (feed)",
  "1080x1920": "Story / Reel 9:16",
};

export function isAdLayout(value: string): value is AdLayoutKind {
  return (AD_LAYOUTS as readonly string[]).includes(value);
}

export function isAdSize(value: string): value is AdSizeKind {
  return (AD_SIZES as readonly string[]).includes(value);
}
