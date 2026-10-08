import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { countNewCombos } from "./comboCap.ts";

const CONCEPTS = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
const LAYOUTS = ["professional_card"];
const SIZES = ["1080x1080", "1080x1350", "1080x1920"];

Deno.test("countNewCombos: a brand-new batch counts every requested combo as new", () => {
  const { existingCount, newCombos } = countNewCombos([], CONCEPTS, LAYOUTS, SIZES);
  assertEquals(existingCount, 0);
  assertEquals(newCombos, 9); // 3 concepts x 1 layout x 3 sizes
});

Deno.test("countNewCombos: re-planning the EXACT same combos counts zero new ones (production regression)", () => {
  // Production bug: re-opening an already-fully-planned 6-concept x
  // 3-format batch (18 existing rows) recomputed combos=18 and added it
  // to existingCount=18, rejecting with "exceeds the 30-creative limit"
  // on a routine reopen that creates nothing new.
  const existing = CONCEPTS.flatMap((c) => LAYOUTS.flatMap((l) => SIZES.map((s) => ({ concept_id: c.id, layout: l, size: s }))));
  const { existingCount, newCombos } = countNewCombos(existing, CONCEPTS, LAYOUTS, SIZES);
  assertEquals(existingCount, 9);
  assertEquals(newCombos, 0);
  // The cap check (existingCount + newCombos > MAX) must pass regardless
  // of how close existingCount already is to the cap.
  assertEquals(existingCount + newCombos <= 30, true);
});

Deno.test("countNewCombos: adding one new format to an already-planned batch only counts the new format's combos", () => {
  const existing = CONCEPTS.flatMap((c) => [{ concept_id: c.id, layout: "professional_card", size: "1080x1080" }]);
  const { existingCount, newCombos } = countNewCombos(existing, CONCEPTS, LAYOUTS, ["1080x1080", "1080x1350"]);
  assertEquals(existingCount, 3);
  assertEquals(newCombos, 3); // only the new 1080x1350 combo per concept
});

Deno.test("countNewCombos: a batch already at the cap still rejects genuinely new combos", () => {
  const thirtyConcepts = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}` }));
  const existing = thirtyConcepts.map((c) => ({ concept_id: c.id, layout: "professional_card", size: "1080x1080" }));
  const { existingCount, newCombos } = countNewCombos(existing, [{ id: "c-new" }], LAYOUTS, ["1080x1080"]);
  assertEquals(existingCount, 30);
  assertEquals(newCombos, 1);
  assertEquals(existingCount + newCombos > 30, true);
});
