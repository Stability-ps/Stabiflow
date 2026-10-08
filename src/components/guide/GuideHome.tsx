import { Link } from "react-router-dom";
import {
  ArrowRight, BarChart3, BookOpen, Building2, Contact, CreditCard, Megaphone, MessageCircle, Plug, Printer, Rocket, Users, Workflow, Wrench, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GUIDE_CHAPTERS, GUIDE_PARTS, chapterPath } from "@/content/guide";
import { GuideSearch } from "@/components/guide/GuideSearch";
import { GuideSupport } from "@/components/guide/GuideSupport";
import { GuideProgressBar } from "@/components/guide/GuideSidebar";
import { useGuideProgress } from "@/hooks/useGuideProgress";
import { cn } from "@/lib/utils";

const JOURNEY: { label: string; slug: string; section?: string }[] = [
  { label: "Set up your business", slug: "business-studio" },
  { label: "Connect integrations", slug: "integrations" },
  { label: "Receive or create leads", slug: "leads" },
  { label: "Communicate on WhatsApp", slug: "messages" },
  { label: "Convert leads to customers", slug: "customers" },
  { label: "Create content and campaigns", slug: "creative-studio" },
  { label: "Automate repetitive work", slug: "automations" },
  { label: "Measure results", slug: "analytics" },
];

const QUICK: { label: string; detail: string; icon: LucideIcon; slug: string; section?: string }[] = [
  { label: "Start here", detail: "Your first hour in StabiFlow", icon: Rocket, slug: "getting-started" },
  { label: "Set up my business", detail: "Business Studio and My Business", icon: Building2, slug: "business-studio" },
  { label: "Connect WhatsApp", detail: "Connect, then run your inbox", icon: MessageCircle, slug: "integrations", section: "connect" },
  { label: "Manage leads", detail: "Qualify, follow up, win", icon: Users, slug: "leads" },
  { label: "Manage customers", detail: "Customer 360", icon: Contact, slug: "customers" },
  { label: "Create marketing", detail: "Adverts, posts and campaigns", icon: Megaphone, slug: "creative-studio" },
  { label: "Build automations", detail: "When, if, then", icon: Workflow, slug: "automations" },
  { label: "Understand analytics", detail: "Read your funnel", icon: BarChart3, slug: "analytics" },
  { label: "Billing & plans", detail: "Plans, payments, Paystack", icon: CreditCard, slug: "billing" },
  { label: "Troubleshooting", detail: "Fix problems by symptom", icon: Wrench, slug: "troubleshooting" },
];

const NEXT_STEPS: { title: string; steps: { label: string; slug: string }[] }[] = [
  { title: "If you're new", steps: [
    { label: "Business Studio", slug: "business-studio" }, { label: "My Business", slug: "my-business" }, { label: "Integrations", slug: "integrations" },
    { label: "Messages", slug: "messages" }, { label: "Leads", slug: "leads" },
  ] },
  { title: "If you want more sales", steps: [
    { label: "Complete your business", slug: "my-business" }, { label: "Create content", slug: "content" }, { label: "Create a campaign", slug: "campaigns" },
    { label: "Capture leads", slug: "leads" }, { label: "Follow up", slug: "leads" }, { label: "Measure in Analytics", slug: "analytics" },
  ] },
  { title: "If you want less admin", steps: [
    { label: "Connect WhatsApp", slug: "integrations" }, { label: "Set up Leads", slug: "leads" }, { label: "Create automations", slug: "automations" },
    { label: "Check run history", slug: "automations" },
  ] },
];

export function GuideHome() {
  const { isRead } = useGuideProgress();
  return (
    <div className="min-w-0 space-y-10">
      <header className="relative rounded-3xl border border-sky-100/80 bg-gradient-to-br from-white via-white to-sky-50/80 p-6 shadow-[0_18px_60px_-42px_hsl(213_82%_45%/0.45)] dark:border-border dark:from-card dark:via-card dark:to-sky-950/20 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">StabiFlow Guide</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">What is StabiFlow?</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          StabiFlow brings your business operations into one workspace: your business identity, customers and leads, WhatsApp, content,
          campaigns, automation and analytics - connected, so each step feeds the next. This guide teaches you all of it, from your first login to advanced use.
        </p>
        <GuideSearch className="mt-6 max-w-xl" />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button asChild><Link to={chapterPath("getting-started")}>Start here <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" /></Link></Button>
          <Button asChild variant="outline"><Link to="/app/guide/book"><Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />Print / book view</Link></Button>
        </div>
      </header>

      <section aria-labelledby="guide-journey">
        <h2 id="guide-journey" className="text-xl font-semibold tracking-tight">How StabiFlow works</h2>
        <p className="mt-1 text-sm text-muted-foreground">Each stage feeds the next. Choose a stage to read its chapter.</p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
          {JOURNEY.map((j, i) => (
            <li key={j.label}>
              <Link to={chapterPath(j.slug, j.section)} className="group flex h-full items-center gap-3 rounded-xl border bg-card p-3 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">{i + 1}</span>
                <span className="text-sm font-medium">{j.label}</span>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="guide-quick">
        <h2 id="guide-quick" className="text-xl font-semibold tracking-tight">Quick start</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-5">
          {QUICK.map((q) => (
            <li key={q.label}>
              <Link to={chapterPath(q.slug, q.section)} className="flex h-full flex-col rounded-2xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><q.icon className="h-4 w-4" aria-hidden="true" /></span>
                <span className="mt-3 font-semibold">{q.label}</span>
                <span className="mt-0.5 text-xs text-muted-foreground">{q.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="guide-next">
        <h2 id="guide-next" className="text-xl font-semibold tracking-tight">What should I do next?</h2>
        <div className="mt-4 grid gap-3 2xl:grid-cols-3">
          {NEXT_STEPS.map((g) => (
            <div key={g.title} className="rounded-2xl border bg-card p-4">
              <h3 className="font-semibold">{g.title}</h3>
              <ol className="mt-3 space-y-1.5">
                {g.steps.map((s, i) => (
                  <li key={`${g.title}-${i}`}>
                    <Link to={chapterPath(s.slug)} className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-accent">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums" aria-hidden="true">{i + 1}</span>
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="guide-all">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="guide-all" className="text-xl font-semibold tracking-tight">All chapters</h2>
            <p className="mt-1 text-sm text-muted-foreground">{GUIDE_CHAPTERS.length} chapters, written for business owners and their teams.</p>
          </div>
          <GuideProgressBar compact />
        </div>
        <div className="mt-4 space-y-6">
          {GUIDE_PARTS.map((part) => (
            <div key={part}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{part}</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {GUIDE_CHAPTERS.filter((c) => c.part === part).map((c) => (
                  <li key={c.slug}>
                    <Link to={chapterPath(c.slug)} className={cn("flex h-full gap-3 rounded-xl border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40", isRead(c.slug) && "bg-muted/30")}>
                      <BookOpen className={cn("mt-0.5 h-4 w-4 shrink-0", isRead(c.slug) ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{c.number}. {c.title}{isRead(c.slug) && <span className="sr-only"> (read)</span>}</span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{c.description}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="guide-plug" className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        <h2 id="guide-plug" className="sr-only">About availability</h2>
        <p><Plug className="mr-1.5 inline h-4 w-4" aria-hidden="true" />Some areas depend on your plan, your role or what's connected. Each chapter shows which plans include it, and tells you if it isn't switched on for your workspace yet.</p>
      </section>

      <GuideSupport />
    </div>
  );
}
