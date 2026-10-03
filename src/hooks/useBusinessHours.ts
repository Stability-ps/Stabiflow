import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toSchedule, validateSchedule, validateOutsideHoursReply, type BusinessHoursDay } from "@/lib/businessHours";

// Phase 12: the workspace's WhatsApp business-hours config. The schedule
// rows (workspace_business_hours) and the enable/auto-reply flags
// (workspace_settings) are both member-readable and admin-writable via
// RLS - no edge function, same shape as the Phase-5 SLA settings.

export type BusinessHoursSettings = {
  business_hours_enabled: boolean;
  outside_hours_auto_reply_enabled: boolean;
  outside_hours_auto_reply_message: string;
  schedule: BusinessHoursDay[];
};

export function useBusinessHoursSettings(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-business-hours", workspaceId],
    queryFn: async (): Promise<BusinessHoursSettings> => {
      const [settingsRes, rowsRes] = await Promise.all([
        supabase.from("workspace_settings")
          .select("business_hours_enabled, outside_hours_auto_reply_enabled, outside_hours_auto_reply_message")
          .eq("workspace_id", workspaceId as string).maybeSingle(),
        supabase.from("workspace_business_hours")
          .select("day_of_week, is_open, opens_at, closes_at")
          .eq("workspace_id", workspaceId as string).order("day_of_week"),
      ]);
      if (settingsRes.error) throw new Error(settingsRes.error.message);
      if (rowsRes.error) throw new Error(rowsRes.error.message);
      return {
        business_hours_enabled: settingsRes.data?.business_hours_enabled ?? false,
        outside_hours_auto_reply_enabled: settingsRes.data?.outside_hours_auto_reply_enabled ?? false,
        outside_hours_auto_reply_message: settingsRes.data?.outside_hours_auto_reply_message ?? "",
        schedule: toSchedule(rowsRes.data ?? []),
      };
    },
    enabled: !!workspaceId,
  });
}

/** Admin-only (RLS: has_workspace_role admin). Persists the flags on
 * workspace_settings; the DB CHECK rejects an enabled auto-reply with a
 * blank message even if this client validation is bypassed. */
export async function updateBusinessHoursSettings(
  workspaceId: string,
  input: { business_hours_enabled?: boolean; outside_hours_auto_reply_enabled?: boolean; outside_hours_auto_reply_message?: string },
) {
  const patch: {
    business_hours_enabled?: boolean;
    outside_hours_auto_reply_enabled?: boolean;
    outside_hours_auto_reply_message?: string | null;
  } = {};
  if (input.business_hours_enabled != null) patch.business_hours_enabled = input.business_hours_enabled;
  if (input.outside_hours_auto_reply_enabled != null) patch.outside_hours_auto_reply_enabled = input.outside_hours_auto_reply_enabled;
  if (input.outside_hours_auto_reply_message != null) patch.outside_hours_auto_reply_message = input.outside_hours_auto_reply_message.trim() || null;

  const nextEnabled = input.outside_hours_auto_reply_enabled ?? undefined;
  const nextMsg = input.outside_hours_auto_reply_message ?? undefined;
  if (nextEnabled === true || (nextEnabled === undefined && nextMsg !== undefined)) {
    const err = validateOutsideHoursReply(nextEnabled ?? true, nextMsg ?? "");
    if (nextEnabled === true && err) throw new Error(err);
  }

  const { error } = await supabase.from("workspace_settings").update(patch).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

/** Admin-only. Upserts all seven weekday rows. Closed days are written
 * with null times so the interval CHECK is satisfied. */
export async function saveBusinessHoursSchedule(workspaceId: string, schedule: BusinessHoursDay[]) {
  const errors = validateSchedule(schedule);
  if (errors.length > 0) throw new Error(errors[0].message);
  const rows = schedule.map((d) => ({
    workspace_id: workspaceId,
    day_of_week: d.day_of_week,
    is_open: d.is_open,
    opens_at: d.is_open ? d.opens_at : null,
    closes_at: d.is_open ? d.closes_at : null,
  }));
  const { error } = await supabase.from("workspace_business_hours").upsert(rows, { onConflict: "workspace_id,day_of_week" });
  if (error) throw new Error(error.message);
}
