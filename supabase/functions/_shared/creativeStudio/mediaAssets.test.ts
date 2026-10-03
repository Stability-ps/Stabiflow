import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readPngDimensions, registerContentMediaAsset, sha256Hex } from "./mediaAssets.ts";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

Deno.test("readPngDimensions: reads width/height from the IHDR", () => {
  assertEquals(readPngDimensions(pngHeader(1080, 1920)), { width: 1080, height: 1920 });
});
Deno.test("readPngDimensions: returns null for non-PNG bytes", () => {
  assertEquals(readPngDimensions(new Uint8Array([1, 2, 3, 4])), null);
});

Deno.test("sha256Hex: deterministic 64-hex-char digest", async () => {
  const a = await sha256Hex(new Uint8Array([1, 2, 3]));
  const b = await sha256Hex(new Uint8Array([1, 2, 3]));
  assertEquals(a, b);
  assertEquals(a.length, 64);
});

Deno.test("registerContentMediaAsset: refuses a storage path that is not workspace-prefixed", async () => {
  await assertRejects(
    () =>
      registerContentMediaAsset({} as never, {
        workspaceId: "ws-1",
        bytes: pngHeader(10, 10),
        storagePath: "someone-else/evil.png",
        title: "x",
        createdBy: null,
      }),
    Error,
    "workspace-prefixed",
  );
});
