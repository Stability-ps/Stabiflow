// Retention V1 - the one piece of retention-tick's logic that is NOT a
// single atomic SQL statement: a media-bearing message's Storage object
// must be deleted BEFORE its DB row is confirmed deleted (never the
// reverse - that would risk an orphaned live object with no DB record
// ever pointing at it again). Kept out of index.ts (which is just the
// thin Deno.serve wrapper, per this repo's convention) so it's testable
// without starting a server.

// deno-lint-ignore no-explicit-any
type AnySb = any;

export type MediaCandidate = { id: string; storage_bucket: string; storage_path: string };

export async function deleteMediaBatch(sb: AnySb, cutoffIso: string, batchSize: number): Promise<{ deleted: number; storageFailed: number }> {
  const { data, error } = await sb.rpc("retention_claim_media_messages_batch", {
    p_cutoff: cutoffIso,
    p_batch_size: batchSize,
  });
  if (error) {
    console.error("retention-tick: media claim failed", error.message);
    return { deleted: 0, storageFailed: 0 };
  }
  const rows = (data ?? []) as MediaCandidate[];
  let deleted = 0;
  let storageFailed = 0;
  for (const row of rows) {
    // .remove() on a path that no longer exists is not an error - treat a
    // missing object as already-clean rather than blocking the DB delete.
    const { error: storageError } = await sb.storage.from(row.storage_bucket).remove([row.storage_path]);
    if (storageError) {
      storageFailed++;
      await sb.rpc("retention_release_media_claim", { p_message_id: row.id });
      continue;
    }
    const { data: confirmed, error: confirmError } = await sb.rpc("retention_confirm_media_message_deleted", { p_message_id: row.id });
    if (confirmError) {
      console.error("retention-tick: confirm-delete failed for a claimed message", confirmError.message);
      continue;
    }
    if (confirmed) deleted++;
  }
  return { deleted, storageFailed };
}
