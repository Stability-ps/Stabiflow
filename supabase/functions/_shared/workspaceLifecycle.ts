// Shared logic for Part 4 (workspace data export + deletion): pure CSV/ZIP
// packaging helpers plus the storage-cleanup routine, kept here so both
// workspace-export and workspace-delete can use the exact same building
// blocks instead of duplicating them.
import { zipSync } from "https://esm.sh/fflate@0.8.2";
import type { AnySupabaseClient } from "./contentAuth.ts";

// Every Storage bucket StabiFlow writes workspace-owned objects into today.
// Deletion must clean up ALL of them, not just the two the original brief
// named - inbox-media (WhatsApp attachments) is a third, nested one level
// deeper (`{workspace_id}/{conversation_id}/{file}` vs the flat
// `{workspace_id}/{file}` the other two use).
export const WORKSPACE_STORAGE_BUCKETS = ["content-media", "workspace-assets", "inbox-media"] as const;

// Recursively lists every object path under a prefix in a bucket. Supabase
// Storage's .list() only returns one "directory" level at a time (folder
// entries come back with id === null) - this walks into every folder entry
// so it works for both the flat buckets (content-media/workspace-assets)
// and inbox-media's one-level-deeper conversation_id nesting without the
// caller needing to know which shape a given bucket uses.
export async function listAllObjectPaths(sb: AnySupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  const stack = [prefix];
  while (stack.length) {
    const current = stack.pop()!;
    let offset = 0;
    const PAGE = 100;
    for (;;) {
      const { data, error } = await sb.storage.from(bucket).list(current, { limit: PAGE, offset });
      if (error || !data) break;
      for (const entry of data) {
        const entryPath = `${current}/${entry.name}`;
        if (entry.id === null) {
          stack.push(entryPath);
        } else {
          paths.push(entryPath);
        }
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }
  return paths;
}

// Removes every object under a workspace's prefix across all three
// workspace-owned buckets. Returns a per-bucket count so the caller can
// record it in platform_deletion_log's cleanup_status. Storage has no FK
// relationship to workspaces.id - this is the only thing that actually
// removes these objects; the DB cascade never reaches Storage.
export async function purgeWorkspaceStorage(sb: AnySupabaseClient, workspaceId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const bucket of WORKSPACE_STORAGE_BUCKETS) {
    const paths = await listAllObjectPaths(sb, bucket, workspaceId);
    if (paths.length) {
      // Storage .remove() takes at most ~1000 paths well; chunk defensively.
      for (let i = 0; i < paths.length; i += 500) {
        await sb.storage.from(bucket).remove(paths.slice(i, i + 500));
      }
    }
    counts[bucket] = paths.length;
  }
  return counts;
}

// --- CSV serialization -------------------------------------------------------

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Converts an array of flat-ish row objects into CSV text. Column set is
// the union of keys across every row (not just the first), so a sparse
// column present only on a later row is never silently dropped.
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((k) => set.add(k));
    return set;
  }, new Set<string>()));
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\r\n");
}

// Bundles a set of named CSV/JSON entries into a single ZIP archive
// (fflate.zipSync - pure JS, no native deps, safe in the edge runtime).
export function buildExportZip(entries: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(entries)) {
    files[name] = encoder.encode(content);
  }
  return zipSync(files, { level: 6 });
}

// The exact, fixed set of exportable entities - deliberately NOT a
// generic "query any table by name" mechanism. Adding a new exportable
// entity means adding a new named function here, reviewed like any other
// code change, never a client-suppliable table name.
export const EXPORT_ENTITIES = [
  "workspace_profile",
  "members",
  "conversations",
  "messages",
  "leads",
  "pipelines",
  "pipeline_stages",
  "opportunities",
  "customers",
  "attribution_events",
  "revenue_events",
  "content_posts",
  "campaigns",
  "automations",
  "automation_runs",
  "ai_conversations",
  "ai_messages",
] as const;
