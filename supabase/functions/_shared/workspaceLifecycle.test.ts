import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { toCsv, buildExportZip, EXPORT_ENTITIES } from "./workspaceLifecycle.ts";

Deno.test("toCsv: empty array produces empty string", () => {
  assertEquals(toCsv([]), "");
});

Deno.test("toCsv: single row round-trips a simple header/value line", () => {
  const csv = toCsv([{ id: "1", name: "Acme" }]);
  assertEquals(csv, "id,name\r\n1,Acme");
});

Deno.test("toCsv: escapes values containing commas, quotes, and newlines", () => {
  const csv = toCsv([{ note: 'Hello, "world"\nnext line' }]);
  assertEquals(csv, 'note\r\n"Hello, ""world""\nnext line"');
});

Deno.test("toCsv: null/undefined values render as empty cells, not the literal string 'null'", () => {
  const csv = toCsv([{ a: null, b: undefined, c: "x" }]);
  assertEquals(csv, "a,b,c\r\n,,x");
});

Deno.test("toCsv: nested objects/arrays are JSON-stringified inline rather than [object Object]", () => {
  const csv = toCsv([{ meta: { a: 1 } }]);
  assertEquals(csv, 'meta\r\n"{""a"":1}"');
});

Deno.test("toCsv: column set is the UNION of keys across all rows, so a sparse column on a later row is not dropped", () => {
  const csv = toCsv([{ a: "1" }, { a: "2", b: "3" }]);
  const lines = csv.split("\r\n");
  assertEquals(lines[0], "a,b");
  assertEquals(lines[1], "1,");
  assertEquals(lines[2], "2,3");
});

Deno.test("buildExportZip: produces a non-empty ZIP-signature byte sequence for a given entry set", () => {
  const zip = buildExportZip({ "a.csv": "x,y\r\n1,2" });
  assertEquals(zip[0], 0x50); // 'P'
  assertEquals(zip[1], 0x4b); // 'K' - the standard ZIP local-file-header magic number
  assertEquals(zip.length > 0, true);
});

Deno.test("buildExportZip: multiple entries all contribute to the archive (larger than a single-entry archive of the same content)", () => {
  const one = buildExportZip({ "a.csv": "hello" });
  const two = buildExportZip({ "a.csv": "hello", "b.csv": "world" });
  assertEquals(two.length > one.length, true);
});

Deno.test("EXPORT_ENTITIES is a fixed, non-empty allow-list (not derived from any runtime/client input)", () => {
  assertEquals(Array.isArray(EXPORT_ENTITIES), true);
  assertEquals(EXPORT_ENTITIES.length > 0, true);
  assertMatch(EXPORT_ENTITIES.join(","), /workspace_profile/);
});
