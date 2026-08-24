import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  chooseInstagramFeedTarget, computeContainLayout, INSTAGRAM_PORTRAIT_TARGET, INSTAGRAM_SQUARE_TARGET,
  needsManualAdjustment,
} from "./contentImageTransform.ts";

Deno.test("REGRESSION (production case): 1536x1024 source chooses the square Instagram target, not portrait", () => {
  // A 1.5:1 landscape source is closer in log-ratio to 1:1 (square) than to
  // 0.8:1 (portrait) - squeezing it into square needs less padding.
  const target = chooseInstagramFeedTarget(1536, 1024);
  assertEquals(target, INSTAGRAM_SQUARE_TARGET);
});

Deno.test("a near-portrait source chooses the portrait Instagram target", () => {
  const target = chooseInstagramFeedTarget(1000, 1200); // ratio 0.833, close to 0.8
  assertEquals(target, INSTAGRAM_PORTRAIT_TARGET);
});

Deno.test("a perfectly square source chooses the square target", () => {
  const target = chooseInstagramFeedTarget(1000, 1000);
  assertEquals(target, INSTAGRAM_SQUARE_TARGET);
});

Deno.test("computeContainLayout never stretches: scale is uniform in both dimensions", () => {
  const layout = computeContainLayout(1536, 1024, { width: 1080, height: 1080 });
  const scaleX = layout.scaledWidth / 1536;
  const scaleY = layout.scaledHeight / 1024;
  assert(Math.abs(scaleX - scaleY) < 0.001); // same scale factor both axes = no stretch
});

Deno.test("computeContainLayout for the production 1536x1024 -> 1080x1080 case matches the real ImageScript smoke test", () => {
  const layout = computeContainLayout(1536, 1024, { width: 1080, height: 1080 });
  assertEquals(layout.scaledWidth, 1080);
  assertEquals(layout.scaledHeight, 720);
  assertEquals(layout.offsetX, 0);
  assertEquals(layout.offsetY, 180); // (1080-720)/2, centered vertically
});

Deno.test("computeContainLayout centers the scaled content within the target frame", () => {
  const layout = computeContainLayout(1536, 1024, { width: 1080, height: 1080 });
  assertEquals(layout.offsetX * 2 + layout.scaledWidth <= 1080 + 1, true);
  assertEquals(layout.offsetY * 2 + layout.scaledHeight <= 1080 + 1, true);
});

Deno.test("the production 1536x1024 case fills 2/3 of the square frame - well above the safety threshold", () => {
  const layout = computeContainLayout(1536, 1024, { width: 1080, height: 1080 });
  assert(layout.fillRatio > 0.6 && layout.fillRatio < 0.7);
  assertEquals(needsManualAdjustment(layout), false);
});

Deno.test("an extremely mismatched aspect ratio (ultra-wide banner into square) needs manual adjustment, not a silent low-fill result", () => {
  const layout = computeContainLayout(3000, 300, { width: 1080, height: 1080 }); // 10:1 banner into 1:1
  assert(layout.fillRatio < 0.5);
  assertEquals(needsManualAdjustment(layout), true);
});

Deno.test("a source that already matches the target ratio fills the entire frame (fillRatio near 1)", () => {
  const layout = computeContainLayout(1080, 1080, { width: 1080, height: 1080 });
  assertEquals(layout.fillRatio, 1);
  assertEquals(needsManualAdjustment(layout), false);
});

Deno.test("computeContainLayout handles upscaling a smaller source the same way as downscaling", () => {
  const layout = computeContainLayout(300, 200, { width: 1200, height: 1200 }); // upscale needed
  assert(layout.scaledWidth > 300);
  const scaleX = layout.scaledWidth / 300;
  const scaleY = layout.scaledHeight / 200;
  assert(Math.abs(scaleX - scaleY) < 0.001);
});
