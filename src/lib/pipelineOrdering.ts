// Pure helper for the pipeline-stage reorder action: turns a staff
// member's drag-and-drop result (the new left-to-right id order) into the
// exact {id, sortOrder} writes the pipelines-actions edge function needs
// to persist - kept separate from the edge function so the "does this
// order list actually belong to this pipeline" question is answered by a
// tested pure function, not buried inline in request-handling code.
export function computeReorderedStages(existingStageIds: string[], orderedStageIds: string[]): { id: string; sortOrder: number }[] {
  const existingSet = new Set(existingStageIds);
  const orderedSet = new Set(orderedStageIds);
  if (orderedStageIds.length !== existingStageIds.length || existingSet.size !== orderedSet.size) {
    throw new Error("Reorder list must contain exactly the pipeline's existing stage ids, each exactly once.");
  }
  for (const id of orderedStageIds) {
    if (!existingSet.has(id)) throw new Error(`Stage ${id} does not belong to this pipeline.`);
  }
  return orderedStageIds.map((id, index) => ({ id, sortOrder: index }));
}
