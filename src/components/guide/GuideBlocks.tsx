import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDown, ArrowRight, CheckSquare, ChevronDown, Info, Lightbulb, ShieldAlert } from "lucide-react";
import { chapterPath } from "@/content/guide";
import type { CalloutTone, GuideBlock, GuideFaqItem, GuideTroubleshootItem, GuideWorkflowStage } from "@/content/guide/types";
import { GuideScreenshot } from "@/components/guide/GuideScreenshot";
import { cn } from "@/lib/utils";

const CALLOUT: Record<CalloutTone, { label: string; icon: typeof Info; className: string }> = {
  tip: { label: "Tip", icon: Lightbulb, className: "border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" },
  important: { label: "Important", icon: Info, className: "border-sky-200 bg-sky-50/70 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100" },
  warning: { label: "Warning", icon: AlertTriangle, className: "border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" },
  note: { label: "Note", icon: ShieldAlert, className: "border-border bg-muted/40 text-foreground" },
};

export function GuideCallout({ tone, title, text }: { tone: CalloutTone; title?: string; text: string }) {
  const c = CALLOUT[tone];
  return (
    <aside className={cn("guide-avoid-break my-5 flex gap-3 rounded-xl border p-4 text-sm leading-6", c.className)} role="note" aria-label={c.label}>
      <c.icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">{title ?? c.label}</p>
        <p className="mt-0.5">{text}</p>
      </div>
    </aside>
  );
}

export function GuideStepList({ steps }: { steps: { title: string; detail?: string }[] }) {
  return (
    <ol className="my-5 space-y-3">
      {steps.map((s, i) => (
        <li key={`${i}-${s.title}`} className="guide-avoid-break flex gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">{i + 1}</span>
          <div className="min-w-0 pt-0.5">
            <p className="font-medium">{s.title}</p>
            {s.detail && <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function GuideWorkflow({ stages, currentChapter }: { stages: GuideWorkflowStage[]; currentChapter?: string }) {
  return (
    <ol className="my-5 grid gap-2" aria-label="Workflow">
      {stages.map((s, i) => {
        const target = s.chapter ?? (s.section ? currentChapter : undefined);
        const body = (
          <>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground" aria-hidden="true">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{s.label}</span>
              {s.detail && <span className="block text-sm text-muted-foreground">{s.detail}</span>}
            </span>
            {target && <ArrowRight className="guide-no-print h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
          </>
        );
        return (
          <li key={`${i}-${s.label}`} className="guide-avoid-break">
            {target ? (
              <Link to={chapterPath(target, s.section)} className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {body}
              </Link>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border bg-card p-3">{body}</div>
            )}
            {i < stages.length - 1 && <ArrowDown className="mx-auto my-0.5 h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export function GuideTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="guide-avoid-break my-5 overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="bg-muted/50">
          <tr>{head.map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => <td key={j} className={cn("px-3 py-2 leading-6", j === 0 ? "font-medium" : "text-muted-foreground")}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GuideFAQ({ items, expanded }: { items: GuideFaqItem[]; expanded?: boolean }) {
  return (
    <div className="my-4 divide-y rounded-xl border">
      {items.map((item) => (
        <details key={item.q} className="guide-faq group px-4" open={expanded || undefined}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span>{item.q}</span>
            <ChevronDown className="guide-no-print h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <p className="pb-4 text-sm leading-6 text-muted-foreground">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

export function GuideTroubleshooting({ items }: { items: GuideTroubleshootItem[] }) {
  const part = (label: string, list: string[]) => list.length > 0 && (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6">{list.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
  return (
    <div className="my-5 space-y-3">
      {items.map((item) => (
        <section key={item.symptom} className="guide-avoid-break rounded-xl border bg-card p-4" aria-label={item.symptom}>
          <p className="font-semibold">{item.symptom}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {part("Possible cause", item.causes)}
            {part("How to check", item.check)}
            {part("How to fix", item.fix)}
          </div>
          {item.contactSupport && (
            <p className="mt-3 rounded-lg bg-muted/50 p-2.5 text-sm"><span className="font-medium">When to contact support: </span>{item.contactSupport}</p>
          )}
        </section>
      ))}
    </div>
  );
}

export function GuideChecklist({ items }: { items: string[] }) {
  return (
    <ul className="my-5 space-y-2 rounded-xl border bg-card p-4">
      {items.map((x) => (
        <li key={x} className="flex items-start gap-2.5 text-sm leading-6">
          <CheckSquare className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );
}

export function GuideBlockView({ block, chapterSlug, expanded }: { block: GuideBlock; chapterSlug?: string; expanded?: boolean }) {
  switch (block.type) {
    case "p": return <p className="my-3 leading-7 text-foreground/90">{block.text}</p>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return <Tag className={cn("my-4 space-y-1.5 pl-5 leading-7 text-foreground/90", block.ordered ? "list-decimal" : "list-disc")}>{block.items.map((x) => <li key={x}>{x}</li>)}</Tag>;
    }
    case "steps": return <GuideStepList steps={block.steps} />;
    case "callout": return <GuideCallout tone={block.tone} title={block.title} text={block.text} />;
    case "screenshot": return <GuideScreenshot shot={block.shot} />;
    case "faq": return <GuideFAQ items={block.items} expanded={expanded} />;
    case "troubleshoot": return <GuideTroubleshooting items={block.items} />;
    case "workflow": return <GuideWorkflow stages={block.stages} currentChapter={chapterSlug} />;
    case "table": return <GuideTable head={block.head} rows={block.rows} />;
    case "checklist": return <GuideChecklist items={block.items} />;
  }
}
