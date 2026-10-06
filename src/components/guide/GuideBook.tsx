import { Link } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GUIDE_CHAPTERS } from "@/content/guide";
import { GuideBlockView } from "@/components/guide/GuideBlocks";
import { availabilityLabel, formatUpdated } from "@/content/guide/format";

/** The whole guide on one page, for printing or saving as PDF. */
export function GuideBook() {
  return (
    <div className="guide-book mx-auto max-w-3xl">
      <div className="guide-no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
        <Button asChild variant="ghost" size="sm"><Link to="/app/guide"><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />Back to the guide</Link></Button>
        <Button size="sm" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />Print or save as PDF</Button>
      </div>
      <header className="guide-book-cover border-b pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">StabiFlow Guide</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">The StabiFlow book</h1>
        <p className="mt-3 text-muted-foreground">Everything you need to run your business in StabiFlow, from your first login to advanced use.</p>
        <ol className="mt-6 columns-1 gap-8 text-sm sm:columns-2">
          {GUIDE_CHAPTERS.map((c) => <li key={c.slug} className="py-0.5"><a href={`#book-${c.slug}`} className="hover:underline">{c.number}. {c.title}</a></li>)}
        </ol>
      </header>
      {GUIDE_CHAPTERS.map((c) => (
        <article key={c.slug} id={`book-${c.slug}`} className="guide-book-chapter pt-10" aria-labelledby={`book-${c.slug}-title`}>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Chapter {c.number}</p>
          <h2 id={`book-${c.slug}-title`} className="mt-1 text-3xl font-semibold tracking-tight">{c.title}</h2>
          <p className="mt-2 text-muted-foreground">{c.description}</p>
          <p className="mt-2 text-xs text-muted-foreground">{availabilityLabel(c.availability)} · Last updated: {formatUpdated(c.updated)}</p>
          {c.sections.map((s) => (
            <section key={s.id} id={`book-${c.slug}-${s.id}`} className="pt-6">
              <h3 className="text-xl font-semibold">{s.title}</h3>
              {s.blocks.map((b, i) => <GuideBlockView key={i} block={b} chapterSlug={c.slug} expanded />)}
            </section>
          ))}
        </article>
      ))}
    </div>
  );
}
