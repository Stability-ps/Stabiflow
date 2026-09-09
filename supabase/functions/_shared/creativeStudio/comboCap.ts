// Creative Studio render planning: the (concept, layout, size) combo cap
// (instruction #10 - at most 30 rendered creatives per batch).
//
// Re-planning an already-fully-planned batch is idempotent by design -
// the caller (creative-studio-render's plan action) upserts with
// ignoreDuplicates:true, so combos that already exist as rows never
// produce a new one. The cap must only count GENUINELY NEW combos
// against the limit; counting the full requested combo set (including
// ones that already exist) double-counts every already-planned combo on
// each re-plan and incorrectly rejects routine reopens/re-renders once a
// batch has more than roughly half the cap already planned (trivially
// reached at the one-click flow's own flagship 6 concepts x 3 formats =
// 18 creatives).

export type ExistingCombo = { concept_id: string; layout: string; size: string };

function comboKey(conceptId: string, layout: string, size: string): string {
  return `${conceptId}|${layout}|${size}`;
}

export function countNewCombos(
  existing: ExistingCombo[],
  concepts: { id: string }[],
  layouts: string[],
  sizes: string[],
): { existingCount: number; newCombos: number } {
  const existingKeys = new Set(existing.map((r) => comboKey(r.concept_id, r.layout, r.size)));
  let newCombos = 0;
  for (const c of concepts) {
    for (const layout of layouts) {
      for (const size of sizes) {
        if (!existingKeys.has(comboKey(c.id, layout, size))) newCombos++;
      }
    }
  }
  return { existingCount: existingKeys.size, newCombos };
}
