import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";
import {
  useBusinessHoursSettings,
  updateBusinessHoursSettings,
  saveBusinessHoursSchedule,
} from "@/hooks/useBusinessHours";
import {
  DAY_LABELS,
  ORDERED_DAYS,
  isOpenAt,
  validateSchedule,
  type BusinessHoursDay,
} from "@/lib/businessHours";

// Phase 12: WhatsApp business hours. The authoritative open/closed +
// business-minute maths is server-side (workspace_is_open_at /
// business_minutes_between / sla_sweep); this card only edits the weekly
// schedule + the enable / outside-hours-reply flags, and shows a cosmetic
// "Open now / Closed now" badge.
export function BusinessHoursCard({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const timezone = useWorkspaceTimezone(workspaceId);
  const { data } = useBusinessHoursSettings(workspaceId);

  const [draft, setDraft] = useState<BusinessHoursDay[] | null>(null);
  const [replyMsg, setReplyMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && draft === null) setDraft(data.schedule);
    if (data && replyMsg === null) setReplyMsg(data.outside_hours_auto_reply_message);
  }, [data, draft, replyMsg]);

  const schedule = useMemo(() => draft ?? data?.schedule ?? [], [draft, data?.schedule]);
  const errors = useMemo(() => validateSchedule(schedule), [schedule]);
  const openNow = useMemo(
    () => (data?.business_hours_enabled ? isOpenAt(schedule, timezone, new Date()) : null),
    [data?.business_hours_enabled, schedule, timezone],
  );
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["workspace-business-hours", workspaceId] });

  const setDay = (dow: number, patch: Partial<BusinessHoursDay>) => {
    setDraft((prev) => (prev ?? data?.schedule ?? []).map((d) => (d.day_of_week === dow ? { ...d, ...patch } : d)));
  };

  const saveFlag = async (patch: Parameters<typeof updateBusinessHoursSettings>[1]) => {
    setSaving(true);
    try {
      await updateBusinessHoursSettings(workspaceId, patch);
      invalidate();
      toast.success("Business hours settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save business hours settings");
    } finally {
      setSaving(false);
    }
  };

  const saveSchedule = async () => {
    if (errors.length > 0) { toast.error(errors[0].message); return; }
    setSaving(true);
    try {
      await saveBusinessHoursSchedule(workspaceId, schedule);
      invalidate();
      toast.success("Business hours schedule saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save the schedule");
    } finally {
      setSaving(false);
    }
  };

  const saveReplyMessage = async () => {
    setSaving(true);
    try {
      await updateBusinessHoursSettings(workspaceId, { outside_hours_auto_reply_message: replyMsg ?? "" });
      invalidate();
      toast.success("Outside-hours reply saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save the message");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Business hours
          {openNow !== null && (
            <Badge variant={openNow ? "outline" : "secondary"} className={openNow ? "text-emerald-700 dark:text-emerald-400" : ""}>
              {openNow ? "Open now" : "Closed now"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={data?.business_hours_enabled ?? false}
            disabled={!canManage || saving}
            onChange={(e) => saveFlag({ business_hours_enabled: e.target.checked })}
          />
          <span>Count the Human Response SLA in business hours only</span>
        </label>
        <p className="text-sm text-muted-foreground">
          When on, the SLA clock pauses while you&apos;re closed and resumes when you next open, so a handoff at 16:55 on a
          10-minute SLA is due at 08:05 the next working day, not 17:05. When off, the SLA is plain elapsed time (unchanged).
        </p>
        <p className="text-xs text-muted-foreground">Times use {timezone}.</p>

        <div className="space-y-1.5">
          {ORDERED_DAYS.map((dow) => {
            const day = schedule.find((d) => d.day_of_week === dow);
            if (!day) return null;
            return (
              <div key={dow} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-24 shrink-0">{DAY_LABELS[dow]}</span>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={day.is_open}
                    disabled={!canManage || saving}
                    onChange={(e) => setDay(dow, e.target.checked
                      ? { is_open: true, opens_at: day.opens_at ?? "08:00", closes_at: day.closes_at ?? "17:00" }
                      : { is_open: false, opens_at: null, closes_at: null })}
                  />
                  Open
                </label>
                {day.is_open ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      type="time"
                      value={day.opens_at ?? ""}
                      disabled={!canManage || saving}
                      onChange={(e) => setDay(dow, { opens_at: e.target.value })}
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                    />
                    <span className="text-muted-foreground">to</span>
                    <input
                      type="time"
                      value={day.closes_at ?? ""}
                      disabled={!canManage || saving}
                      onChange={(e) => setDay(dow, { closes_at: e.target.value })}
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                    />
                  </span>
                ) : (
                  <span className="text-muted-foreground">Closed</span>
                )}
              </div>
            );
          })}
        </div>
        {errors.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{errors[0].message}</p>}
        {canManage && (
          <Button size="sm" variant="outline" disabled={saving || errors.length > 0} onClick={saveSchedule}>
            Save schedule
          </Button>
        )}

        <div className="space-y-2 border-t pt-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={data?.outside_hours_auto_reply_enabled ?? false}
              disabled={!canManage || saving || !(data?.business_hours_enabled ?? false)}
              onChange={(e) => saveFlag({
                outside_hours_auto_reply_enabled: e.target.checked,
                ...(e.target.checked ? { outside_hours_auto_reply_message: (replyMsg ?? "").trim() } : {}),
              })}
            />
            <span>Send one automatic reply when a customer messages outside business hours</span>
          </label>
          <p className="text-sm text-muted-foreground">
            Sent at most once per conversation per closed period. Opening again never sends a message.
          </p>
          <Textarea
            value={replyMsg ?? ""}
            disabled={!canManage || saving}
            maxLength={1000}
            placeholder="Thanks for your message. We're currently outside our business hours and will reply when we're open."
            onChange={(e) => setReplyMsg(e.target.value)}
            className="min-h-[64px] text-sm"
          />
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              disabled={saving || (replyMsg ?? "") === (data?.outside_hours_auto_reply_message ?? "")}
              onClick={saveReplyMessage}
            >
              Save message
            </Button>
          )}
        </div>

        {!canManage && <p className="text-xs text-muted-foreground">Only workspace owners and admins can change this.</p>}
      </CardContent>
    </Card>
  );
}
