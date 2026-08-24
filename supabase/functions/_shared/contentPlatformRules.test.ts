import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateAssetForPlatform } from "./contentPlatformRules.ts";

Deno.test("a well-formed post passes Facebook feed validation", () => {
  const result = validateAssetForPlatform({ mimeType: "image/jpeg", width: 1200, height: 630, fileSizeBytes: 500_000 }, "facebook_feed");
  assertEquals(result.valid, true);
  assertEquals(result.failures, []);
});

Deno.test("a well-formed square post passes Instagram feed validation", () => {
  const result = validateAssetForPlatform({ mimeType: "image/jpeg", width: 1080, height: 1080, fileSizeBytes: 500_000 }, "instagram_feed");
  assertEquals(result.valid, true);
});

Deno.test("an unsupported MIME type is rejected with a clear reason, not silently accepted", () => {
  const result = validateAssetForPlatform({ mimeType: "image/webp", width: 1080, height: 1080, fileSizeBytes: 500_000 }, "instagram_feed");
  assertEquals(result.valid, false);
  assert(result.failures.some((f) => f.code === "unsupported_mime_type"));
});

Deno.test("too-small dimensions are rejected", () => {
  const result = validateAssetForPlatform({ mimeType: "image/png", width: 100, height: 100, fileSizeBytes: 10_000 }, "instagram_feed");
  assertEquals(result.valid, false);
  assert(result.failures.some((f) => f.code === "too_small"));
});

Deno.test("an extreme aspect ratio is rejected for Instagram feed even if dimensions are otherwise in range", () => {
  const result = validateAssetForPlatform({ mimeType: "image/jpeg", width: 1440, height: 400, fileSizeBytes: 500_000 }, "instagram_feed");
  assertEquals(result.valid, false);
  assert(result.failures.some((f) => f.code === "aspect_ratio_out_of_range"));
});

Deno.test("an oversized file is rejected", () => {
  const result = validateAssetForPlatform({ mimeType: "image/jpeg", width: 1200, height: 630, fileSizeBytes: 20 * 1024 * 1024 }, "facebook_feed");
  assertEquals(result.valid, false);
  assert(result.failures.some((f) => f.code === "file_too_large"));
});

Deno.test("LinkedIn is architecturally present but reports unsupported, never silently accepted as publishable", () => {
  const result = validateAssetForPlatform({ mimeType: "image/jpeg", width: 1200, height: 630, fileSizeBytes: 500_000 }, "linkedin_company_page");
  assertEquals(result.valid, false);
  assert(result.failures.some((f) => f.code === "unsupported_platform"));
});

Deno.test("a poster can fail Instagram but pass Facebook independently (canonical, per-platform rules, not one shared guess)", () => {
  const wide = { mimeType: "image/jpeg", width: 1600, height: 500, fileSizeBytes: 500_000 };
  const fb = validateAssetForPlatform(wide, "facebook_feed");
  const ig = validateAssetForPlatform(wide, "instagram_feed");
  assertEquals(fb.valid, false);
  assertEquals(ig.valid, false);
  assert(fb.failures.length > 0 && ig.failures.length > 0);

  const fbOnly = { mimeType: "image/jpeg", width: 1200, height: 720, fileSizeBytes: 500_000 }; // 1.67 ratio: within FB (0.5-1.91) and IG (0.8-1.91)
  assertEquals(validateAssetForPlatform(fbOnly, "facebook_feed").valid, true);
  assertEquals(validateAssetForPlatform(fbOnly, "instagram_feed").valid, true);
});
