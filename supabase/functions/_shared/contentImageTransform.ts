// Pure geometry/decision logic for the platform-variant pipeline, kept
// separate from the actual pixel manipulation (contentImageProcessor.ts,
// which depends on the ImageScript WASM library) so the rules governing
// *what* gets generated are unit-testable without decoding real images.
//
// Ported unchanged from Acapolite's _shared/socialImageTransform.ts.
//
// Design choice: every variant is produced by "contain" (scale to fit
// within the target frame, preserving the full source, then pad the
// remainder) - never "cover/crop". Crop-to-fill risks cutting off text or
// logos near the edges of a poster, which this product deliberately
// forbids doing silently. Contain can never lose content; the only cost is
// padding. When contain would need to pad away more than half the frame
// (the source's aspect ratio is too different from the target's to look
// right), that's flagged as needing manual adjustment instead of silently
// shipping a mostly-blank poster.

export type ImageTarget = { width: number; height: number };

export type ContainLayout = {
  scaledWidth: number;
  scaledHeight: number;
  offsetX: number;
  offsetY: number;
  fillRatio: number; // (scaledWidth*scaledHeight) / (targetWidth*targetHeight), 0-1
};

export function computeContainLayout(sourceWidth: number, sourceHeight: number, target: ImageTarget): ContainLayout {
  const scale = Math.min(target.width / sourceWidth, target.height / sourceHeight);
  const scaledWidth = Math.max(1, Math.round(sourceWidth * scale));
  const scaledHeight = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.round((target.width - scaledWidth) / 2);
  const offsetY = Math.round((target.height - scaledHeight) / 2);
  const fillRatio = (scaledWidth * scaledHeight) / (target.width * target.height);
  return { scaledWidth, scaledHeight, offsetX, offsetY, fillRatio };
}

// Below this, more than half the target frame would be empty padding -
// the source's shape is too different from the target's to auto-convert
// safely. Flag for a human instead of shipping a mostly-blank poster.
export const MIN_SAFE_FILL_RATIO = 0.5;

export function needsManualAdjustment(layout: ContainLayout): boolean {
  return layout.fillRatio < MIN_SAFE_FILL_RATIO;
}

// Instagram feed target: portrait (1080x1350, 4:5) is preferred, but a
// source whose own aspect ratio is closer to square than to portrait fits
// the square fallback (1080x1080) with less padding - compared in log-ratio
// space so "half as wide" and "twice as wide" count as equally different.
export const INSTAGRAM_PORTRAIT_TARGET: ImageTarget = { width: 1080, height: 1350 };
export const INSTAGRAM_SQUARE_TARGET: ImageTarget = { width: 1080, height: 1080 };

export function chooseInstagramFeedTarget(sourceWidth: number, sourceHeight: number): ImageTarget {
  const sourceRatio = sourceWidth / sourceHeight;
  const portraitRatio = INSTAGRAM_PORTRAIT_TARGET.width / INSTAGRAM_PORTRAIT_TARGET.height;
  const squareRatio = INSTAGRAM_SQUARE_TARGET.width / INSTAGRAM_SQUARE_TARGET.height;
  const portraitDiff = Math.abs(Math.log(sourceRatio) - Math.log(portraitRatio));
  const squareDiff = Math.abs(Math.log(sourceRatio) - Math.log(squareRatio));
  return squareDiff < portraitDiff ? INSTAGRAM_SQUARE_TARGET : INSTAGRAM_PORTRAIT_TARGET;
}

// Facebook feed accepts a much wider range (0.5-1.91 aspect ratio, 600x315
// to 8192x8192), so a variant is only needed when the original is outside
// that range or too small/large - most posts never need one. When one is
// needed, 1200x1200 is a safe universal target: square (1.0) sits
// comfortably inside Facebook's allowed ratio range regardless of which
// direction the original was out of range in.
export const FACEBOOK_FALLBACK_TARGET: ImageTarget = { width: 1200, height: 1200 };
