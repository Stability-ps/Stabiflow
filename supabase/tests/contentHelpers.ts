import { admin } from "./helpers";

/** A minimal, valid single-pixel PNG - real bytes, not a placeholder string, so storage upload tests exercise the real code path. */
const ONE_PIXEL_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

export async function seedWorkspaceIntegration(workspaceId: string) {
  const { data, error } = await admin
    .from("workspace_integrations")
    .insert({ workspace_id: workspaceId, provider: "meta", status: "connected" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed workspace_integrations: ${error?.message}`);
  return data.id as string;
}

export async function seedFacebookPage(workspaceId: string, integrationId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("workspace_facebook_pages")
    .insert({ workspace_id: workspaceId, integration_id: integrationId, page_id: `${Date.now()}${Math.floor(Math.random() * 10000)}`, page_name: "Test Page", ...overrides })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed workspace_facebook_pages: ${error?.message}`);
  return data.id as string;
}

export async function seedMediaAsset(workspaceId: string, createdBy: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("content_media_assets")
    .insert({
      workspace_id: workspaceId,
      title: "Test asset",
      storage_path: `${workspaceId}/seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
      mime_type: "image/png",
      width_px: 1200,
      height_px: 630,
      aspect_ratio: 1.905,
      file_size_bytes: 1024,
      checksum_sha256: "0".repeat(64),
      created_by: createdBy,
      ...overrides,
    })
    .select("id, storage_path")
    .single();
  if (error || !data) throw new Error(`Failed to seed content_media_assets: ${error?.message}`);
  return data as { id: string; storage_path: string };
}

export async function seedScheduledPost(workspaceId: string, mediaAssetId: string, facebookPageId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("content_scheduled_posts")
    .insert({
      workspace_id: workspaceId,
      media_asset_id: mediaAssetId,
      target_platform: "facebook",
      facebook_page_id: facebookPageId,
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      caption: "Test caption",
      status: "scheduled",
      idempotency_key: `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed content_scheduled_posts: ${error?.message}`);
  return data.id as string;
}

/** Uploads a real, tiny PNG to the content-media bucket AS THE GIVEN CLIENT (so storage RLS applies exactly as it would for a real user), returning the object path. */
export async function uploadRealTestObject(client: import("@supabase/supabase-js").SupabaseClient, workspaceId: string) {
  const path = `${workspaceId}/rls-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const file = new File([ONE_PIXEL_PNG], "pixel.png", { type: "image/png" });
  const { error } = await client.storage.from("content-media").upload(path, file, { contentType: "image/png" });
  if (error) throw new Error(`Failed to upload real test object: ${error.message}`);
  return path;
}
