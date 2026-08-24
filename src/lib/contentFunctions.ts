import { supabase } from "@/integrations/supabase/client";

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // supabase-js surfaces a non-2xx edge function response as `error`
    // without the JSON body attached in every SDK version - fall back to a
    // generic message if the structured `error` field on the parsed body
    // (data) isn't available.
    const message = (data as { error?: string } | null)?.error || error.message || `${name} failed`;
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export type SchedulePostInput = {
  workspace_id: string;
  target_platform: "facebook" | "instagram";
  facebook_page_id?: string;
  instagram_account_id?: string;
  media_asset_id: string;
  caption: string;
  hashtags?: string[];
  scheduled_at: string;
  status?: "draft" | "scheduled";
};

export function scheduleContentPost(input: SchedulePostInput) {
  return invoke<{ ok: true; post: { id: string; status: string; scheduled_at: string } }>("content-schedule-post", input);
}

export function publishContentPostNow(scheduledPostId: string) {
  return invoke<{ ok: boolean; outcome: string; status: string; post: Record<string, unknown> }>("content-publish-now", { scheduled_post_id: scheduledPostId });
}

export function generateContentPlatformVariants(workspaceId: string, mediaAssetId: string) {
  return invoke<{ ok: true; results: Array<{ platform: string; status: string; message?: string }> }>("content-generate-variants", {
    workspace_id: workspaceId,
    media_asset_id: mediaAssetId,
  });
}

export function getContentSchedulerSettings(workspaceId: string) {
  return invoke<{ workspace_id: string; auto_publish_enabled: boolean; env_kill_switch_allows: boolean }>("content-scheduler-settings", {
    action: "get",
    workspace_id: workspaceId,
  });
}

export function setContentSchedulerSettings(workspaceId: string, enabled: boolean) {
  return invoke<{ ok: true; auto_publish_enabled: boolean; env_kill_switch_allows: boolean; changed: boolean }>("content-scheduler-settings", {
    action: "set",
    workspace_id: workspaceId,
    auto_publish_enabled: enabled,
  });
}
