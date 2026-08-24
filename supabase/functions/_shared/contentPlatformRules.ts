// Single canonical source of platform posting requirements. Every place
// that needs to know "is this image OK for platform X" (asset upload
// validation, single-post/series scheduling, the publish worker's final
// guard) imports from here - never duplicate a hardcoded limit elsewhere.
//
// Ported unchanged from Acapolite's _shared/socialPlatformRules.ts.
// Sources (checked at time of writing, re-verify against Meta's current
// developer docs before raising limits): Meta Graph API feed photo
// publishing docs for Facebook Pages and Instagram Business accounts.

export type ContentPlatformKey = "facebook_feed" | "instagram_feed" | "linkedin_company_page";

export type PlatformImageRules = {
  key: ContentPlatformKey;
  label: string;
  supported: boolean; // false = architecture-ready placeholder, not yet implemented
  allowedMimeTypes: string[];
  minWidthPx: number;
  minHeightPx: number;
  maxWidthPx: number;
  maxHeightPx: number;
  minAspectRatio: number; // width / height
  maxAspectRatio: number;
  maxFileSizeBytes: number;
  maxCaptionLength: number;
};

export const CONTENT_PLATFORM_RULES: Record<ContentPlatformKey, PlatformImageRules> = {
  facebook_feed: {
    key: "facebook_feed",
    label: "Facebook Feed",
    supported: true,
    allowedMimeTypes: ["image/jpeg", "image/png"],
    minWidthPx: 600,
    minHeightPx: 315,
    maxWidthPx: 8192,
    maxHeightPx: 8192,
    minAspectRatio: 0.5, // 1:2 (tall)
    maxAspectRatio: 1.91, // Meta's standard landscape link/feed image ratio ceiling
    maxFileSizeBytes: 8 * 1024 * 1024,
    maxCaptionLength: 63206,
  },
  instagram_feed: {
    key: "instagram_feed",
    label: "Instagram Feed",
    supported: true,
    allowedMimeTypes: ["image/jpeg", "image/png"],
    minWidthPx: 320,
    minHeightPx: 320,
    maxWidthPx: 1440,
    maxHeightPx: 1800,
    minAspectRatio: 0.8, // 4:5 portrait, Instagram's tightest supported ratio
    maxAspectRatio: 1.91, // 1.91:1 landscape ceiling
    maxFileSizeBytes: 8 * 1024 * 1024,
    maxCaptionLength: 2200,
  },
  linkedin_company_page: {
    key: "linkedin_company_page",
    label: "LinkedIn Company Page",
    supported: false,
    allowedMimeTypes: ["image/jpeg", "image/png"],
    minWidthPx: 552,
    minHeightPx: 276,
    maxWidthPx: 7680,
    maxHeightPx: 4320,
    minAspectRatio: 0.5625,
    maxAspectRatio: 1.91,
    maxFileSizeBytes: 10 * 1024 * 1024,
    maxCaptionLength: 3000,
  },
};

export function getPlatformRules(key: ContentPlatformKey): PlatformImageRules {
  const rules = CONTENT_PLATFORM_RULES[key];
  if (!rules) throw new Error(`Unknown platform key: ${key}`);
  return rules;
}

// Maps content_platform ("facebook", "instagram", "linkedin") to its
// validation-rules key ("facebook_feed", etc). Kept in one place so every
// caller stays in sync on which ruleset applies to which platform.
export function platformKeyForContentPlatform(platform: string): ContentPlatformKey {
  if (platform === "facebook") return "facebook_feed";
  if (platform === "instagram") return "instagram_feed";
  if (platform === "linkedin") return "linkedin_company_page";
  throw new Error(`Unknown content platform: ${platform}`);
}

export type AssetForValidation = {
  mimeType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
};

export type ValidationFailure = {
  code:
    | "unsupported_platform"
    | "unsupported_mime_type"
    | "too_small"
    | "too_large_dimensions"
    | "aspect_ratio_out_of_range"
    | "file_too_large";
  message: string;
};

export type ValidationResult = {
  platform: ContentPlatformKey;
  valid: boolean;
  aspectRatio: number;
  failures: ValidationFailure[];
};

export function validateAssetForPlatform(asset: AssetForValidation, platform: ContentPlatformKey): ValidationResult {
  const rules = CONTENT_PLATFORM_RULES[platform];
  const failures: ValidationFailure[] = [];

  if (!rules) {
    return {
      platform,
      valid: false,
      aspectRatio: asset.height > 0 ? asset.width / asset.height : 0,
      failures: [{ code: "unsupported_platform", message: `Unknown platform: ${platform}` }],
    };
  }

  if (!rules.supported) {
    failures.push({ code: "unsupported_platform", message: `${rules.label} publishing is not implemented yet.` });
  }

  if (!rules.allowedMimeTypes.includes(asset.mimeType)) {
    failures.push({
      code: "unsupported_mime_type",
      message: `${rules.label} only accepts ${rules.allowedMimeTypes.join(", ")}, got ${asset.mimeType}.`,
    });
  }

  if (asset.width < rules.minWidthPx || asset.height < rules.minHeightPx) {
    failures.push({
      code: "too_small",
      message: `${rules.label} requires at least ${rules.minWidthPx}x${rules.minHeightPx}px, got ${asset.width}x${asset.height}px.`,
    });
  }

  if (asset.width > rules.maxWidthPx || asset.height > rules.maxHeightPx) {
    failures.push({
      code: "too_large_dimensions",
      message: `${rules.label} allows at most ${rules.maxWidthPx}x${rules.maxHeightPx}px, got ${asset.width}x${asset.height}px.`,
    });
  }

  const aspectRatio = asset.height > 0 ? asset.width / asset.height : 0;
  if (aspectRatio < rules.minAspectRatio || aspectRatio > rules.maxAspectRatio) {
    failures.push({
      code: "aspect_ratio_out_of_range",
      message: `${rules.label} requires an aspect ratio between ${rules.minAspectRatio} and ${rules.maxAspectRatio}, got ${aspectRatio.toFixed(3)}.`,
    });
  }

  if (asset.fileSizeBytes > rules.maxFileSizeBytes) {
    failures.push({
      code: "file_too_large",
      message: `${rules.label} allows at most ${Math.round(rules.maxFileSizeBytes / (1024 * 1024))}MB, file is ${(asset.fileSizeBytes / (1024 * 1024)).toFixed(2)}MB.`,
    });
  }

  return { platform, valid: failures.length === 0, aspectRatio, failures };
}
