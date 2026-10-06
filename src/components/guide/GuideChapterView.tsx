import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, BookOpenCheck, Check, ExternalLink, Link2, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adjacentChapters, chapterPath, getChapter, type GuideChapter } from "@/content/guide";
import { AVAILABILITY_NOTE } from "@/content/guide/common";
import { availabilityLabel, formatUpdated } from "@/content/guide/format";
import { GuideBlockView } from "@/components/guide/GuideBlocks";
import { GuideFeedback } from "@/components/guide/GuideFeedback";
import { GuideSupport } from "@/components/guide/GuideSupport";
import { useGuideProgress } from "@/hooks/useGuideProgress";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import type { FeatureFlagKey } from "@/lib/featureFlags";

// Chapter -> module flag, only to tell a reader "not on your workspace yet".
// The guide itself is never gated.
const CHAPTER_FLAG: Partial<Record<string, FeatureFlagKey>> = {
  "creative-studio": "module.creative_studio",
  content: "module.content",
  campaigns: "module.campaigns",
  messages: "module.whatsapp",
  leads: "module.leads",
  customers: "module.customers",
  automations: "module.automations",
  "flow-ai": "module.flow_ai",
  analytics: "module.analytics",
  integrations: "module.integrations",
};

function useScrollToHash(slug: string) {
  const { hash } = useLocation();
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    if (!id) {
      // New chapter without an anchor: start at the very top. Either the
      // window or <main> scrolls depending on the layout, so reset both.
      window.scrollTo({ top: 0 });
      document.querySelector("main")?.scrollTo({ top: 0 });
      return;
    }
    // Wait a frame so the chapter has rendered before scrolling.
    const t = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: "start" });
        el.focus({ preventScroll: true });
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [hash, slug]);
}

export function GuideChapterView({ chapter }: { chapter: GuideChapter }) {
  const navigate = useNavigate();
  const { isEnabled, isLoading } = useFeatureFlags();
  const { isRead, setChapterRead } = useGuideProgress();
  const { previous, next } = adjacentChapters(chapter.slug);
  const flag = CHAPTER_FLAG[chapter.slug];
  const notOnWorkspace = !!flag && !isLoading && !isEnabled(flag);
  const read = isRead(chapter.slug);
  const label = availabilityLabel(chapter.availability);
  useScrollToHash(chapter.slug);

  function copyLink(sectionId: string) {
    const url = `${window.location.origin}${chapterPath(chapter.slug, sectionId)}`;
    navigator.clipboard?.writeText(url).then(() => toast.success("Link copied"), () => toast.error("Couldn't copy the link"));
  }

  return (
    <article className="min-w-0" aria-labelledby="guide-chapter-title">
      <nav aria-label="Breadcrumb" className="guide-no-print mb-3 text-sm text-muted-foreground">
        <Link to="/app/guide" className="hover:text-foreground hover:underline">Guide</Link>
        <span aria-hidden="true"> / </span>
        <span>{chapter.part}</span>
      </nav>

      <header className="border-b pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Chapter {chapter.number}</p>
        <h1 id="guide-chapter-title" className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{chapter.title}</h1>
        <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">{chapter.description}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {label && <Badge variant="secondary">{label}</Badge>}
          <span>Last updated: {formatUpdated(chapter.updated)}</span>
        </div>
        <div className="guide-no-print mt-4 flex flex-wrap gap-2">
          {chapter.appPath && !notOnWorkspace && (
            <Button asChild size="sm"><Link to={chapter.appPath}><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />Open {chapter.title.replace(/ \(.*\)$/, "")}</Link></Button>
          )}
          <Button size="sm" variant="outline" onClick={() => navigate("/app/guide/book")}><Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />Print guide</Button>
        </div>
        {notOnWorkspace && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            This area isn't switched on for your workspace yet. {AVAILABILITY_NOTE} <Link to="/app/billing" className="font-medium underline underline-offset-4">See plans</Link>
          </p>
        )}
      </header>

      {chapter.sections.length > 2 && (
        <nav aria-label="On this page" className="guide-no-print mt-6 rounded-xl border bg-muted/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this page</p>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {chapter.sections.map((s) => (
              <li key={s.id}><Link to={chapterPath(chapter.slug, s.id)} className="text-foreground/80 hover:text-primary hover:underline">{s.title}</Link></li>
            ))}
          </ol>
        </nav>
      )}

      {chapter.sections.map((s) => (
        <section key={s.id} id={s.id} tabIndex={-1} aria-labelledby={`${s.id}-title`} className="guide-section scroll-mt-32 pt-8 outline-none xl:scroll-mt-24">
          <div className="group flex items-start gap-2">
            <h2 id={`${s.id}-title`} className="text-xl font-semibold tracking-tight sm:text-2xl">{s.title}</h2>
            <button
              type="button"
              onClick={() => copyLink(s.id)}
              className="guide-no-print mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Copy link to "${s.title}"`}
            >
              <Link2 className="h-4 w-4" />
            </button>
          </div>
          {s.blocks.map((b, i) => <GuideBlockView key={i} block={b} chapterSlug={chapter.slug} />)}
        </section>
      ))}

      <div className="guide-no-print mt-10 space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">{read ? "You've marked this chapter as read." : "Finished this chapter?"}</p>
          <Button type="button" size="sm" variant={read ? "outline" : "default"} onClick={() => setChapterRead(chapter.slug, !read)} aria-pressed={read}>
            {read ? <><Check className="mr-1.5 h-4 w-4" aria-hidden="true" />Read</> : <><BookOpenCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />Mark as read</>}
          </Button>
        </div>

        <GuideFeedback key={chapter.slug} articleSlug={chapter.slug} />

        {chapter.related && chapter.related.length > 0 && (
          <section aria-labelledby="guide-related">
            <h2 id="guide-related" className="text-sm font-semibold">Related articles</h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {chapter.related.map(getChapter).filter((c): c is GuideChapter => !!c).map((c) => (
                <li key={c.slug}>
                  <Link to={chapterPath(c.slug)} className="block rounded-xl border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
                    <span className="block text-sm font-medium">{c.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{c.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <nav aria-label="Chapter navigation" className="grid gap-2 sm:grid-cols-2">
          {previous ? (
            <Link to={chapterPath(previous.slug)} className="group rounded-xl border p-3 hover:border-primary/40 hover:bg-accent/40" rel="prev">
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Previous</span>
              <span className="mt-0.5 block text-sm font-medium">{previous.title}</span>
            </Link>
          ) : <span />}
          {next && (
            <Link to={chapterPath(next.slug)} onClick={() => setChapterRead(chapter.slug, true)} className="group rounded-xl border p-3 text-right hover:border-primary/40 hover:bg-accent/40" rel="next">
              <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">Next<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
              <span className="mt-0.5 block text-sm font-medium">{next.title}</span>
            </Link>
          )}
        </nav>

        <GuideSupport />
      </div>
    </article>
  );
}
