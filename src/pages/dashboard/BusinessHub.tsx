import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Award, Briefcase, Building2, CalendarDays, ChevronRight, FileText, Files, FolderKanban, Info, Palette, Sparkles, Users, Wand2, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { computeCompleteness, fetchBusinessIdentity } from "@/lib/businessIdentity";
import { fetchPendingProposals } from "@/lib/businessStudio";

type HubLink = { label: string; to: string; icon: LucideIcon; detail?: string; section?: string };

/**
 * Mobile "Business" tab: one coherent entry point to Business Studio, My
 * Business and Documents. Every link goes to an existing route and every
 * number comes from the same queries those pages use - nothing here is a
 * second Business Studio, it only organises the existing one for a phone.
 */
export default function BusinessHub() {
  const { currentWorkspaceId: ws, currentMembership } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const studioOn = isEnabled("module.business_studio");
  const identity = useQuery({ queryKey: ["business-identity", ws], queryFn: () => fetchBusinessIdentity(ws as string), enabled: !!ws });
  const pending = useQuery({ queryKey: ["fact-proposals", ws], queryFn: () => fetchPendingProposals(ws as string), enabled: !!ws });
  const completeness = useMemo(() => (identity.data ? computeCompleteness(identity.data) : null), [identity.data]);
  const name = identity.data?.identity.trading_name || identity.data?.identity.legal_name || currentMembership?.workspace.name || "Your business";
  const pendingCount = pending.data?.length ?? 0;

  const status = (section?: string) => {
    if (!section || !completeness) return null;
    const items = completeness.items.filter((i) => i.section === section);
    if (!items.length) return null;
    const done = items.filter((i) => i.done).length;
    return done === items.length ? "Complete" : done === 0 ? "To do" : "In progress";
  };

  const groups: { title: string; links: HubLink[] }[] = [
    {
      title: "Your business",
      links: [
        ...(studioOn ? [{ label: "Business Studio", to: "/app/business-studio", icon: Wand2, detail: "Scan your website and build your profile" }] : []),
        { label: "My Business", to: "/app/business", icon: Building2, detail: "All your business details" },
        { label: "Documents", to: "/app/documents", icon: Files, detail: "Your company profile PDFs" },
      ],
    },
    {
      title: "Profile details",
      links: [
        { label: "Company", to: "/app/business?section=company", icon: Building2, section: "company" },
        { label: "About", to: "/app/business?section=about", icon: Info, section: "about" },
        { label: "Services & products", to: "/app/business?section=offerings", icon: Briefcase, section: "offerings" },
        { label: "Brand assets", to: "/app/business?section=branding", icon: Palette, section: "branding" },
        { label: "Team", to: "/app/business?section=team", icon: Users, section: "team" },
        { label: "Projects & case studies", to: "/app/business?section=projects", icon: FolderKanban, section: "projects" },
        { label: "Certifications & registrations", to: "/app/business?section=credentials", icon: Award, section: "credentials" },
      ],
    },
    {
      title: "Create",
      links: [
        ...(studioOn ? [{ label: "Company profile PDF", to: "/app/business-studio", icon: FileText, detail: "Design, preview and download" }] : []),
        ...(isEnabled("module.content") ? [{ label: "Content", to: "/app/content", icon: CalendarDays, detail: "Posts, calendar and media library" }] : []),
      ],
    },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <div>
        <h1 className="truncate text-xl font-semibold tracking-tight">{name}</h1>
        {!completeness ? (
          <div className="mt-2 h-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none" role="status" aria-label="Loading" />
        ) : (
          <Link to="/app/business" className="mt-1 block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Profile</span>
              <span className="font-medium tabular-nums">{completeness.score}% complete</span>
            </span>
            <span className="mt-1.5 block h-1.5 rounded-full bg-muted" role="progressbar" aria-valuenow={completeness.score} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness">
              <span className="block h-1.5 rounded-full bg-primary" style={{ width: `${completeness.score}%` }} />
            </span>
          </Link>
        )}
      </div>

      {pendingCount > 0 ? (
        <Link to="/app/business?section=review" className="flex min-h-14 items-center gap-3 rounded-xl border border-sky-300 bg-sky-50/60 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-sky-950/20">
          <Sparkles className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
          <span className="flex-1">
            <span className="font-medium">{pendingCount} change{pendingCount === 1 ? "" : "s"} to review</span>
            <span className="block text-xs text-muted-foreground">Found on your website or in your documents</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </Link>
      ) : studioOn ? (
        <Link to="/app/business?section=scan" className="flex min-h-14 items-center gap-3 rounded-xl border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            <span className="font-medium">Scan &amp; complete profile</span>
            <span className="block text-xs text-muted-foreground">We read your website and suggest details for you to approve</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </Link>
      ) : null}

      {groups.filter((g) => g.links.length > 0).map((g) => (
        <section key={g.title} aria-labelledby={`hub-${g.title}`}>
          <h2 id={`hub-${g.title}`} className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {g.links.map((l) => {
              const st = status(l.section);
              return (
                <li key={`${l.label}-${l.to}`}>
                  <Link to={l.to} className="flex min-h-14 items-center gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent">
                    <l.icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{l.label}</span>
                      {l.detail ? <span className="block truncate text-xs text-muted-foreground">{l.detail}</span> : null}
                    </span>
                    {st ? <span className={`shrink-0 text-xs ${st === "To do" ? "font-medium text-primary" : "text-muted-foreground"}`}>{st}</span> : null}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
