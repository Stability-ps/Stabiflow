import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Instruction #13 / test #18: a copy-only re-render (the `store` action of
// this function) must make ZERO image-generation calls. The strongest
// guarantee is structural - this function never pulls in the image
// provider module and never names an image endpoint at all.
Deno.test("creative-studio-render never references the image-generation provider", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertEquals(src.includes("generateVisual"), false);
  assertEquals(src.includes("images/generations"), false);
  assertEquals(src.includes("OPENAI_IMAGE_MODEL"), false);
});
