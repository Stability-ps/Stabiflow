import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { BookOpen, CheckCircle2, ChevronDown, Circle } from "lucide-react";
import { GUIDE_CHAPTERS, GUIDE_PARTS, getChapter } from "@/content/guide";
import { useGuideProgress } from "@/hooks/useGuideProgress";
import { cn } from "@/lib/utils";

export function GuideProgressBar({ compact }: { compact?: boolean }) {
  const { read } = useGuideProgress();
  const done = GUIDE_CHAPTERS.filter((c) => read.has(c.slug)).length;
  const pct = Math.round((done / GUIDE_CHAPTERS.length) * 100);
  return (
    <div className={cn("guide-no-print", compact ? "" : "rounded-xl border bg-card p-3")}>
      <p className="text-xs font-medium text-muted-foreground">{done} of {GUIDE_CHAPTERS.length} chapters read</p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Guide progress">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ChapterList({ onNavigate }: { onNavigate?: () => void }) {
  const { isRead } = useGuideProgress();
  return (
    <nav aria-label="Guide chapters" className="space-y-4">
      <NavLink to="/app/guide" end onClick={onNavigate} className={({ isActive }) => cn("flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium hover:bg-accent", isActive && "bg-accent text-foreground")}>
        <BookOpen className="h-4 w-4" aria-hidden="true" /> Guide home
      </NavLink>
      {GUIDE_PARTS.map((part) => (
        <div key={part}>
          <p className="px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{part}</p>
          <ul className="mt-1 space-y-0.5">
            {GUIDE_CHAPTERS.filter((c) => c.part === part).map((c) => (
              <li key={c.slug}>
                <NavLink
                  to={`/app/guide/${c.slug}`}
                  onClick={onNavigate}
                  className={({ isActive }) => cn(
                    "flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[13.5px] text-foreground/80 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive && "bg-primary/10 font-semibold text-foreground",
                  )}
                >
                  {isRead(c.slug)
                    ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-label="Read" />
                    : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />}
                  <span><span className="tabular-nums text-muted-foreground">{c.number}.</span> {c.title}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Desktop: sticky chapter column. */
export function GuideSidebar() {
  return (
    <aside className="guide-no-print sticky top-[calc(3.75rem+env(safe-area-inset-top)+1rem)] hidden max-h-[calc(100dvh-3.75rem-2rem)] w-64 shrink-0 space-y-4 self-start overflow-y-auto pb-6 pr-2 xl:block" data-testid="guide-sidebar">
      <GuideProgressBar />
      <ChapterList />
    </aside>
  );
}

/** Phone/tablet: sticky "Chapters" selector that expands into the full list. */
export function GuideMobileNav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const current = getChapter(pathname.split("/")[3]);
  return (
    <div className="guide-no-print sticky top-[calc(3.75rem+env(safe-area-inset-top))] z-20 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-7 md:px-7 xl:hidden" data-testid="guide-mobile-nav">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="guide-mobile-chapters"
        className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{current ? `${current.number}. ${current.title}` : "Chapters"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div id="guide-mobile-chapters" className="max-h-[65dvh] overflow-y-auto pb-3 pt-2">
          <GuideProgressBar compact />
          <div className="mt-3"><ChapterList onNavigate={() => setOpen(false)} /></div>
          <Link to="/app/guide/book" className="mt-3 block px-2.5 text-sm text-primary underline-offset-4 hover:underline">Read the whole guide as a book</Link>
        </div>
      )}
    </div>
  );
}
