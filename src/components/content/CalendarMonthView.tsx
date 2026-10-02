import { useMemo, useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MediaPreview } from "@/components/content/MediaPreview";
import { useAuth } from "@/hooks/useAuth";
import { useContentScheduledPosts } from "@/hooks/useContentScheduledPosts";
import { formatInTimezone } from "@/lib/contentTimezone";

const STATUS_DOT: Record<string, string> = {
  scheduled: "bg-blue-500",
  publishing: "bg-blue-500",
  published: "bg-emerald-500",
  failed: "bg-red-500",
  draft: "bg-muted-foreground",
};

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
  const [month, setMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const rangeStart = startOfWeek(startOfMonth(month));
  const rangeEnd = endOfWeek(endOfMonth(month));
  const days = useMemo(() => eachDayOfInterval({ start: rangeStart, end: rangeEnd }), [rangeStart, rangeEnd]);

  const { data: posts, isLoading } = useContentScheduledPosts(currentWorkspaceId, "all", {
    from: rangeStart.toISOString(),
    to: rangeEnd.toISOString(),
  });

  const postsByDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const post of (posts as CalendarPost[] | undefined) || []) {
      const key = format(new Date(post.scheduled_at), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(post);
    }
    return map;
  }, [posts]);

  const selectedDayPosts = selectedDay ? postsByDay.get(format(selectedDay, "yyyy-MM-dd")) || [] : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{format(month, "MMMM yyyy")}</h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => setMonth((m) => subMonths(m, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setMonth(new Date())}>Today</Button>
          <Button variant="outline" size="sm" onClick={() => setMonth((m) => addMonths(m, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-center text-xs font-medium text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-muted/50 py-1.5">{d}</div>
        ))}
      </div>

      <div className={`grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border ${isLoading ? "opacity-60" : ""}`}>
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayPosts = postsByDay.get(key) || [];
          const inMonth = isSameMonth(day, month);
          const isToday = isSameDay(day, new Date());
          return (
            <button
              key={key}
              type="button"
              onClick={() => dayPosts.length > 0 && setSelectedDay(day)}
              className={`flex min-h-[84px] flex-col gap-1 bg-background p-1.5 text-left transition-colors ${inMonth ? "" : "opacity-40"} ${dayPosts.length ? "hover:bg-muted/60" : "cursor-default"}`}
            >
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${isToday ? "bg-primary text-primary-foreground" : ""}`}>
                {format(day, "d")}
              </span>
              <div className="flex flex-wrap gap-0.5">
                {dayPosts.slice(0, 4).map((p) => (
                  <span key={p.id} className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[p.status] || "bg-muted-foreground"}`} />
                ))}
                {dayPosts.length > 4 && <span className="text-[10px] text-muted-foreground">+{dayPosts.length - 4}</span>}
              </div>
            </button>
          );
        })}
      </div>

      <Dialog open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedDay ? format(selectedDay, "EEEE, MMMM d") : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {selectedDayPosts.map((post) => (
              <div key={post.id} className="flex items-center gap-3 rounded-md border p-2">
                {post.content_media_assets && (
                  <MediaPreview storagePath={post.content_media_assets.storage_path} alt={post.content_media_assets.title} className="h-12 w-12 shrink-0 rounded" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{post.status}</Badge>
                    <span className="text-xs capitalize text-muted-foreground">{post.target_platform}</span>
                  </div>
                  <p className="truncate text-sm">{post.caption}</p>
                  <p className="text-xs text-muted-foreground">{formatInTimezone(post.scheduled_at, workspaceTimezone)}</p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
