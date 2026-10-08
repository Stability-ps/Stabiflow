import { useMemo, useState } from "react";
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { ComposePostDialog } from "@/components/content/ComposePostDialog";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MediaPreview } from "@/components/content/MediaPreview";
import { useAuth } from "@/hooks/useAuth";
import { useContentScheduledPosts } from "@/hooks/useContentScheduledPosts";
import { calendarDateKey, dateKeyInZone, formatInTimezone, startOfCalendarDayInZone, todayInZone } from "@/lib/contentTimezone";
import { postStatus } from "@/lib/contentPostStatus";

const DOT: Record<StatusTone, string> = {
  info: "bg-info-solid", success: "bg-success-solid", danger: "bg-destructive", neutral: "bg-subtle-foreground", warning: "bg-warning-solid", brand: "bg-brand",
};

/** "3 posts: 2 scheduled, 1 failed" - the dots are colour only, so the day says it in words. */
function dayLabel(day: Date, posts: CalendarPost[]): string {
  const date = format(day, "EEEE d MMMM");
  if (!posts.length) return `${date}, no posts`;
  const counts = new Map<string, number>();
  for (const p of posts) { const l = postStatus(p.status).label.toLowerCase(); counts.set(l, (counts.get(l) ?? 0) + 1); }
  return `${date}, ${posts.length} post${posts.length === 1 ? "" : "s"}: ${[...counts].map(([l, n]) => `${n} ${l}`).join(", ")}`;
}

type CalendarPost = {
  id: string;
  scheduled_at: string;
  status: string;
  target_platform: string;
  caption: string;
  content_media_assets: { title: string; storage_path: string } | null;
};

export function CalendarMonthView({ workspaceTimezone }: { workspaceTimezone: string }) {
  const { currentWorkspaceId } = useAuth();
  // The grid's Date objects are plain calendar dates (y/m/d only). Every
  // instant -> day mapping goes through the WORKSPACE timezone, so a post
  // scheduled for 09:00 in the workspace never shows on a different day
  // for someone viewing from another timezone.
  const today = todayInZone(workspaceTimezone);
  const todayKey = calendarDateKey(today);
  const [month, setMonth] = useState(() => today);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDay, setComposeDay] = useState<Date | null>(null);

  const rangeStart = startOfWeek(startOfMonth(month));
  const rangeEnd = endOfWeek(endOfMonth(month));
  const days = useMemo(() => eachDayOfInterval({ start: rangeStart, end: rangeEnd }), [rangeStart, rangeEnd]);

  const { data: posts, isLoading, isError, refetch } = useContentScheduledPosts(currentWorkspaceId, "all", {
    from: startOfCalendarDayInZone(rangeStart, workspaceTimezone).toISOString(),
    to: startOfCalendarDayInZone(addDays(rangeEnd, 1), workspaceTimezone).toISOString(),
  });

  const postsByDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const post of (posts as CalendarPost[] | undefined) || []) {
      const key = dateKeyInZone(post.scheduled_at, workspaceTimezone);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(post);
    }
    return map;
  }, [posts, workspaceTimezone]);

  const selectedDayPosts = selectedDay ? postsByDay.get(calendarDateKey(selectedDay)) || [] : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-title-section text-foreground" aria-live="polite">{format(month, "MMMM yyyy")}</h3>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Previous month" onClick={() => setMonth((m) => subMonths(m, 1))}><ChevronLeft aria-hidden="true" /></Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => setMonth(today)}>Today</Button>
          <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}><ChevronRight aria-hidden="true" /></Button>
        </div>
      </div>

      {isError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive-strong">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Couldn't load this month's posts - the calendar below may look empty when it isn't.</span>
          <Button variant="outline" size="sm" className="bg-card" onClick={() => void refetch()}>Try again</Button>
        </div>
      )}

      <div aria-hidden="true" className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-center text-overline uppercase text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-background py-1.5">{d}</div>
        ))}
      </div>

      <div className={`grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border ${isLoading ? "opacity-60" : ""}`}>
        {days.map((day) => {
          const key = calendarDateKey(day);
          const dayPosts = postsByDay.get(key) || [];
          const inMonth = isSameMonth(day, month);
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedDay(day)}
              aria-label={dayLabel(day, dayPosts)}
              aria-current={isToday ? "date" : undefined}
              className={`flex min-h-[64px] flex-col gap-1 bg-card p-1.5 text-left transition-colors duration-fast hover:bg-accent/60 focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-[84px] ${inMonth ? "" : "bg-background text-subtle-foreground"}`}
            >
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums ${isToday ? "bg-primary font-semibold text-primary-foreground" : inMonth ? "text-foreground" : ""}`}>
                {format(day, "d")}
              </span>
              <div className="flex flex-wrap gap-0.5">
                {dayPosts.slice(0, 4).map((p) => (
                  <span key={p.id} className={`h-2 w-2 rounded-full ${DOT[postStatus(p.status).tone]}`} />
                ))}
                {dayPosts.length > 4 && <span className="text-[10px] leading-none text-muted-foreground">+{dayPosts.length - 4}</span>}
              </div>
            </button>
          );
        })}
      </div>

      <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(["scheduled", "published", "failed", "draft"] as const).map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[postStatus(k).tone]}`} />{postStatus(k).label}</li>
        ))}
      </ul>

      <Dialog open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center justify-between gap-3 pr-6"><span>{selectedDay ? format(selectedDay, "EEEE, MMMM d") : ""}</span><Button size="sm" onClick={() => { setComposeDay(selectedDay); setSelectedDay(null); setComposeOpen(true); }}><Plus aria-hidden="true" /> Add post</Button></DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {selectedDayPosts.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Nothing scheduled for this day yet. Add as many posts as you need.</p>}
            {selectedDayPosts.map((post) => (
              <div key={post.id} className="flex items-center gap-3 rounded-lg border border-border p-2">
                {post.content_media_assets && (
                  <MediaPreview storagePath={post.content_media_assets.storage_path} alt={post.content_media_assets.title} className="h-12 w-12 shrink-0 rounded-md object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusPill tone={postStatus(post.status).tone}>{postStatus(post.status).label}</StatusPill>
                    <span className="text-xs capitalize text-muted-foreground">{post.target_platform}</span>
                  </div>
                  <p className="truncate text-sm text-foreground">{post.caption}</p>
                  <p className="text-xs text-muted-foreground">{formatInTimezone(post.scheduled_at, workspaceTimezone)}</p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {/* Keyed by day: the dialog seeds its schedule from initialDate only on
          mount, so a new day must remount it or it keeps the first value. */}
      <ComposePostDialog key={composeDay ? calendarDateKey(composeDay) : "new"} open={composeOpen} onOpenChange={setComposeOpen} workspaceTimezone={workspaceTimezone} initialDate={composeDay ?? undefined} />
    </div>
  );
}
