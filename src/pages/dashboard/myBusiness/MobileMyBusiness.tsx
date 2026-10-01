import { useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Award, Briefcase, Building2, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Files, FolderKanban, Globe, Info, Loader2, MapPin, Palette, Phone,
  Radar, Share2, Sparkles, Users, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import type { BusinessIdentityBundle, CompletenessItem } from "@/lib/businessIdentity";
import { BusinessStudioError, fetchPendingProposals, scanWebsite } from "@/lib/businessStudio";

export type MyBusinessBlock =
  | "header" | "progress" | "review" | "company" | "about" | "save" | "branding" | "contacts" | "locations" | "offerings" | "social"
  | "team" | "projects" | "certifications" | "monitor" | "identifiers";

type SectionKey = "company" | "about" | "offerings" | "contacts" | "locations" | "branding" | "social" | "team" | "projects" | "credentials" | "monitor";

// `completeness` = the computeCompleteness() section each card reports on.
const SECTIONS: { key: SectionKey; label: string; icon: LucideIcon; blocks: MyBusinessBlock[]; completeness?: string; saves?: boolean }[] = [
  { key: "company", label: "Company", icon: Building2, blocks: ["company"], completeness: "company", saves: true },
  { key: "about", label: "About", icon: Info, blocks: ["about"], completeness: "about", saves: true },
  { key: "offerings", label: "Services", icon: Briefcase, blocks: ["offerings"], completeness: "offerings" },
  { key: "contacts", label: "Contact", icon: Phone, blocks: ["contacts"], completeness: "contacts" },
  { key: "locations", label: "Location", icon: MapPin, blocks: ["locations"], completeness: "locations" },
  { key: "branding", label: "Brand", icon: Palette, blocks: ["branding"], completeness: "branding" },
  { key: "social", label: "Social media", icon: Share2, blocks: ["social"], completeness: "social" },
  { key: "team", label: "Team", icon: Users, blocks: ["team"], completeness: "team" },
  { key: "projects", label: "Projects", icon: FolderKanban, blocks: ["projects"], completeness: "projects" },
  { key: "credentials", label: "Certifications", icon: Award, blocks: ["certifications", "identifiers"], completeness: "credentials" },
  { key: "monitor", label: "Website monitoring", icon: Radar, blocks: ["monitor"] },
];
const SECTION_KEYS = SECTIONS.map((s) => s.key) as string[];
const isSectionKey = (v: string | null): v is SectionKey => !!v && SECTION_KEYS.includes(v);

type State = "complete" | "partial" | "missing" | "none";

function sectionState(items: CompletenessItem[], section?: string): State {
  const own = items.filter((i) => i.section === section);
  if (!own.length) return "none";
  const done = own.filter((i) => i.done).length;
  return done === own.length ? "complete" : done === 0 ? "missing" : "partial";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function summaryFor(key: SectionKey, b: BusinessIdentityBundle): string | null {
  const i = b.identity;
  switch (key) {
    case "company": return [i.trading_name || i.legal_name, i.industry].filter(Boolean).join(" · ") || null;
    case "about": return i.short_description || null;
    case "offerings": return b.offerings.length ? plural(b.offerings.length, "service or product", "services and products") : null;
    case "contacts": return (b.contacts.find((c) => c.is_primary) ?? b.contacts[0])?.value ?? null;
    case "locations": return b.locations[0] ? [b.locations[0].city, b.locations[0].region].filter(Boolean).join(", ") || b.locations[0].address_line1 : null;
    case "branding": return i.brand_profile_id ? "Brand linked" : null;
    case "social": return b.socialLinks.map((s) => s.platform).join(", ") || null;
    case "team": return b.team.length ? plural(b.team.length, "person", "people") : null;
    case "projects": return b.projects.length ? plural(b.projects.length, "project") : null;
    case "credentials": {
      const n = b.certifications.length + b.identifiers.length;
      return n ? plural(n, "credential") : null;
    }
    case "monitor": return "Get told when your website changes";
  }
}

/**
 * My Business on phones: compact progress, an actionable completion card,
 * "Scan & complete profile" (the existing Business Studio website scan ->
 * business_fact_proposals flow), Changes to review, and one compact card per
 * section. The section editors themselves are the exact desktop blocks.
 */
export function MobileMyBusiness({ workspaceId, bundle, completeness, blocks, canEdit, saving, dirty, onSave }: {
  workspaceId: string;
  bundle: BusinessIdentityBundle;
  completeness: { score: number; items: CompletenessItem[] };
  blocks: Record<MyBusinessBlock, ReactNode>;
  canEdit: boolean;
  saving: boolean;
  /** Company/About form has unsaved edits. */
  dirty: boolean;
  /** The canonical My Business save (same handler as desktop); resolves true on success. */
  onSave: () => Promise<boolean>;
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { isEnabled } = useFeatureFlags();
  const studioOn = isEnabled("module.business_studio");
  const [showMissing, setShowMissing] = useState(false);
  const pushed = useRef(false);
  const pending = useQuery({ queryKey: ["fact-proposals", workspaceId], queryFn: () => fetchPendingProposals(workspaceId) });
  const pendingCount = pending.data?.length ?? 0;

  const view = params.get("section");
  const open = (section: string, replace = false) => {
    pushed.current = pushed.current || !replace;
    setParams((p) => { const n = new URLSearchParams(p); n.set("section", section); return n; }, { replace });
    window.scrollTo({ top: 0 });
  };
  const close = () => {
    if (pushed.current) {
      pushed.current = false;
      navigate(-1);
    } else {
      setParams((p) => { const n = new URLSearchParams(p); n.delete("section"); return n; }, { replace: true });
    }
  };

  const backBar = (
    <button type="button" onClick={close} className="-ml-2 flex h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />All sections
    </button>
  );

  if (view === "review" || view === "scan") {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {backBar}
        {view === "scan" && studioOn && canEdit ? <ScanCard workspaceId={workspaceId} website={bundle.identity.website} onScanned={() => open("review", true)} /> : null}
        {blocks.review}
      </div>
    );
  }

  if (isSectionKey(view)) {
    const sec = SECTIONS.find((s) => s.key === view)!;
    const next = SECTIONS[SECTIONS.indexOf(sec) + 1];
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {backBar}
        <h1 className="sr-only">{sec.label}</h1>
        {sec.blocks.map((b) => <div key={b}>{blocks[b]}</div>)}
        <div className="sticky bottom-[calc(var(--bottom-nav-height)+0.75rem)] z-10 grid grid-cols-2 gap-2 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur">
          {sec.saves && canEdit ? (
            <>
              {/* Done never discards edits: unsaved changes are saved first,
                  and the section only closes once that succeeded. */}
              <Button variant="outline" disabled={saving} onClick={async () => { if (!dirty || (await onSave())) close(); }}>Done</Button>
              <Button onClick={() => void onSave()} disabled={saving || !dirty}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{dirty ? "Save" : "Saved"}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={close}>Done</Button>
              {next ? (
                <Button onClick={() => open(next.key, true)}>Next: {next.label}<ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
              ) : (
                <Button asChild><Link to="/app/documents">Documents</Link></Button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  const missing = completeness.items.filter((i) => !i.done).sort((a, b) => b.weight - a.weight);
  const important = missing.filter((i) => i.weight >= 8);
  const firstMissing = missing[0]?.section;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">My Business</h1>
          <span className="text-sm font-medium tabular-nums">{completeness.score}% complete</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-muted" role="progressbar" aria-valuenow={completeness.score} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness">
          <div className="h-1.5 rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${completeness.score}%` }} />
        </div>
      </div>

      {missing.length > 0 ? (
        <section aria-labelledby="setup-heading" className="rounded-xl border bg-card p-4" data-testid="complete-profile-card">
          <h2 id="setup-heading" className="font-semibold">Complete your business profile</h2>
          <p className="text-sm text-muted-foreground">{plural(missing.length, "item")} remaining{important.length ? ` · ${important.length} important` : ""}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button className="min-w-[9rem] flex-1" onClick={() => firstMissing && open(firstMissing)} disabled={!firstMissing}>Continue setup</Button>
            <Button variant="outline" onClick={() => setShowMissing((v) => !v)} aria-expanded={showMissing} aria-controls="missing-list">
              {showMissing ? "Hide" : "What's missing"}
              <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${showMissing ? "rotate-180" : ""}`} aria-hidden="true" />
            </Button>
          </div>
          {showMissing ? (
            <ul id="missing-list" className="mt-3 flex flex-wrap gap-1.5">
              {missing.map((m) => (
                <li key={m.key}>
                  <button type="button" onClick={() => open(m.section)}
                    className={`min-h-11 rounded-full border px-3.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${m.weight >= 8 ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "text-muted-foreground"}`}>
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {pendingCount > 0 ? (
        <button type="button" onClick={() => open("review")} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-sky-300 bg-sky-50/60 px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-sky-950/20">
          <Sparkles className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
          <span className="flex-1">
            <span className="font-medium">{pendingCount} change{pendingCount === 1 ? "" : "s"} to review</span>
            <span className="block text-xs text-muted-foreground">Nothing changes until you accept it</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button>
      ) : null}

      {studioOn && canEdit ? <ScanCard workspaceId={workspaceId} website={bundle.identity.website} compact onScanned={() => open("review")} /> : null}

      <nav aria-label="Business sections">
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {SECTIONS.map((sec) => {
            const state = sectionState(completeness.items, sec.completeness);
            const done = state === "complete";
            const value = summaryFor(sec.key, bundle);
            const action = !canEdit ? "View" : done || state === "none" ? "Edit" : state === "partial" ? "Finish" : "Add";
            return (
              <li key={sec.key}>
                <button type="button" onClick={() => open(sec.key)} aria-label={`${sec.label}: ${value ?? (state === "missing" ? "not added yet" : "open")}. ${action}`}
                  className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40" : "bg-muted text-muted-foreground"}`}>
                    <sec.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {sec.label}
                      {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{value ?? (state === "missing" ? "Not added yet" : "Optional")}</span>
                  </span>
                  <span className={`shrink-0 text-xs font-medium ${action === "Edit" || action === "View" ? "text-muted-foreground" : "text-primary"}`}>{action}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            );
          })}
          <li>
            <Link to="/app/documents" className="flex min-h-16 w-full items-center gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Files className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Documents</span><span className="block text-xs text-muted-foreground">Your company profile PDFs</span></span>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">Open</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}

/**
 * "Scan & complete profile": runs the existing Business Studio website scan
 * (business-studio edge function -> website_scans -> business_fact_proposals).
 * Findings arrive as proposals for review; nothing is written directly.
 */
function ScanCard({ workspaceId, website, compact = false, onScanned }: { workspaceId: string; website: string | null; compact?: boolean; onScanned: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(website ?? "");
  const scan = useMutation({
    mutationFn: () => scanWebsite(workspaceId, url),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["fact-proposals", workspaceId] });
      qc.invalidateQueries({ queryKey: ["business-identity", workspaceId] });
      toast.success(r.proposalsCreated ? `Found ${r.proposalsCreated} detail${r.proposalsCreated === 1 ? "" : "s"} to review` : "Nothing new found - your details are up to date.");
      if (r.proposalsCreated) onScanned();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      if (e instanceof BusinessStudioError && e.code === "limit_reached") toast.info("See Billing for plans with more allowance.");
    },
  });
  return (
    <section aria-labelledby="scan-heading" className="rounded-xl border bg-gradient-to-br from-primary/[0.04] to-sky-500/[0.06] p-4" data-testid="scan-profile-card">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="scan-heading" className="font-semibold">Scan &amp; complete profile</h2>
          {!compact ? <p className="text-sm text-muted-foreground">We read a few public pages of your website and suggest details. You approve every change.</p> : null}
        </div>
      </div>
      <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) scan.mutate(); }}>
        <Label htmlFor="scan-url" className="sr-only">Website to scan</Label>
        <Input id="scan-url" type="url" inputMode="url" autoComplete="url" placeholder="www.yourbusiness.co.za" value={url} onChange={(e) => setUrl(e.target.value)} className="bg-background" />
        <Button type="submit" className="w-full" disabled={!url.trim() || scan.isPending}>
          {scan.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Globe className="h-4 w-4" aria-hidden="true" />}
          {scan.isPending ? "Reading your website..." : "Scan & complete profile"}
        </Button>
        {scan.isPending ? <p className="text-xs text-muted-foreground" role="status">This can take up to a minute.</p> : null}
      </form>
    </section>
  );
}
