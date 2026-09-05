// Retention V1 - proves the ONE piece of correctness that lives in code
// rather than in a single atomic SQL statement: the order of operations
// around a Storage delete. The SQL-level guards (retry-eligible/claimed/
// dead-lettered/lead-attachment-referenced never selected at all) are
// exercised for real against local Supabase in
// supabase/tests/retention-v1.test.ts - this file only needs a fake `sb`.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deleteMediaBatch } from "./retentionMedia.ts";

const CUTOFF = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();

function fakeSb(opts: {
  claimed: Array<{ id: string; storage_bucket: string; storage_path: string }>;
  storageShouldFail: (path: string) => boolean;
}) {
  const calls: string[] = [];
  return {
    calls,
    sb: {
      rpc(name: string, args?: Record<string, unknown>) {
        calls.push(`${name}(${JSON.stringify(args ?? {})})`);
        if (name === "retention_claim_media_messages_batch") return Promise.resolve({ data: opts.claimed, error: null });
        if (name === "retention_confirm_media_message_deleted") return Promise.resolve({ data: true, error: null });
        if (name === "retention_release_media_claim") return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
      },
      storage: {
        from(bucket: string) {
          return {
            remove(paths: string[]) {
              calls.push(`storage.remove(${bucket}:${paths.join(",")})`);
              const failed = paths.some((p) => opts.storageShouldFail(p));
              return Promise.resolve(failed ? { data: null, error: { message: "storage failure" } } : { data: {}, error: null });
            },
          };
        },
      },
    },
  };
}

Deno.test("deleteMediaBatch: deletes the Storage object BEFORE confirming the DB row deleted", async () => {
  const { sb, calls } = fakeSb({
    claimed: [{ id: "m1", storage_bucket: "inbox-media", storage_path: "ws1/m1.jpg" }],
    storageShouldFail: () => false,
  });
  const result = await deleteMediaBatch(sb, CUTOFF, 200);
  assertEquals(result, { deleted: 1, storageFailed: 0 });
  const storageIdx = calls.findIndex((c) => c.startsWith("storage.remove"));
  const confirmIdx = calls.findIndex((c) => c.startsWith("retention_confirm_media_message_deleted"));
  assertEquals(storageIdx >= 0 && confirmIdx > storageIdx, true, "storage delete must happen before confirm-delete");
});

Deno.test("deleteMediaBatch: a Storage failure releases the claim and NEVER confirms the DB delete", async () => {
  const { sb, calls } = fakeSb({
    claimed: [{ id: "m2", storage_bucket: "inbox-media", storage_path: "ws1/m2.jpg" }],
    storageShouldFail: () => true,
  });
  const result = await deleteMediaBatch(sb, CUTOFF, 200);
  assertEquals(result, { deleted: 0, storageFailed: 1 });
  assertEquals(calls.some((c) => c.startsWith("retention_confirm_media_message_deleted")), false);
  assertEquals(calls.some((c) => c.startsWith("retention_release_media_claim(") && c.includes("m2")), true);
});

Deno.test("deleteMediaBatch: a mix of success/failure across a batch handles each row independently", async () => {
  const { sb } = fakeSb({
    claimed: [
      { id: "ok1", storage_bucket: "inbox-media", storage_path: "ws1/ok1.jpg" },
      { id: "bad1", storage_bucket: "inbox-media", storage_path: "ws1/bad1.jpg" },
      { id: "ok2", storage_bucket: "inbox-media", storage_path: "ws1/ok2.jpg" },
    ],
    storageShouldFail: (path) => path.includes("bad1"),
  });
  const result = await deleteMediaBatch(sb, CUTOFF, 200);
  assertEquals(result, { deleted: 2, storageFailed: 1 });
});

Deno.test("deleteMediaBatch: an empty claim batch is a safe no-op", async () => {
  const { sb } = fakeSb({ claimed: [], storageShouldFail: () => false });
  const result = await deleteMediaBatch(sb, CUTOFF, 200);
  assertEquals(result, { deleted: 0, storageFailed: 0 });
});
