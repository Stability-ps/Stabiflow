import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Copy, FileText, Heart, Library, Search, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { useInboxTemplates } from "@/hooks/useInboxTemplates";
import { useWhatsAppTemplateLibrary } from "@/hooks/useWhatsAppTemplateLibrary";
import { useWhatsAppTemplateFavorites } from "@/hooks/useWhatsAppTemplateFavorites";
import { filterWhatsAppTemplates, whatsappTemplateBody } from "@/pages/dashboard/whatsapp/templateFilters";
import { useWhatsAppOutlet } from "@/pages/dashboard/whatsapp/whatsappOutlet";
import { toast } from "sonner";

function statusTone(status: string): "default" | "secondary" | "outline" | "destructive" {
  const s = status.toUpperCase();
  if (s === "APPROVED") return "default";
  if (s === "REJECTED" || s === "DISABLED" || s === "PAUSED") return "destructive";
  if (s === "PENDING") return "outline";
  return "secondary";
}

const PAGE_SIZE = 50;

// Read-only manager for templates synced from Meta. StabiFlow deliberately
// does not submit provider templates in V1; creation/approval stays in Meta.
export default function WhatsAppTemplates() {
  const { workspaceId } = useWhatsAppOutlet();
  const { data: templates, isLoading } = useInboxTemplates(workspaceId);
  const { data: library, isLoading: libraryLoading } = useWhatsAppTemplateLibrary();
  const { favorites, toggleFavorite } = useWhatsAppTemplateFavorites();
  const [source, setSource] = useState<"synced" | "library">("synced");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [selectedLibraryTemplateId, setSelectedLibraryTemplateId] = useState<string | null>(null);
  const [selectedMetaTemplateId, setSelectedMetaTemplateId] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  const libraryIndustries = useMemo(
    () => Array.from(new Set((library || []).map((t) => t.industry)).values()).sort(),
    [library],
  );
  const [industry, setIndustry] = useState("ALL");
  const selectedLibraryTemplate = useMemo(() => (library || []).find((t) => t.id === selectedLibraryTemplateId) || null, [library, selectedLibraryTemplateId]);
  const selectedMetaTemplate = useMemo(() => (templates || []).find((t) => t.id === selectedMetaTemplateId) || null, [templates, selectedMetaTemplateId]);
  const filteredLibrary = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (library || []).filter((t) => {
      const matchesQuery = !needle || [t.name, t.industry, t.use_case, t.body].some((value) => value.toLowerCase().includes(needle));
      const matchesCategory = category === "ALL" || t.category === category;
      const matchesIndustry = industry === "ALL" || t.industry === industry;
      const matchesFavorite = !favoritesOnly || favorites.has(t.id);
      return matchesQuery && matchesCategory && matchesIndustry && matchesFavorite;
    });
  }, [library, query, category, industry, favoritesOnly, favorites]);

  const categories = useMemo(
    () => Array.from(new Set((templates || []).map((t) => t.category || "Uncategorised"))).sort(),
    [templates],
  );
  const statuses = useMemo(
    () => Array.from(new Set((templates || []).map((t) => t.provider_status))).sort(),
    [templates],
  );

  const filtered = useMemo(
    () => filterWhatsAppTemplates(templates || [], query, category, status),
    [templates, query, category, status],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const approvedCount = (templates || []).filter((t) => t.provider_status.toUpperCase() === "APPROVED").length;
  const hasFilters = Boolean(query.trim()) || category !== "ALL" || status !== "ALL";

  function resetPage() {
    setPage(1);
  }

  if (isLoading || libraryLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  if (!templates || templates.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No templates synced yet"
        description="Message templates are created in Meta and synced into StabiFlow. Connect WhatsApp, or use Refresh under Settings, to pull them in."
        action={<Link to="/app/whatsapp/settings" className="text-sm font-medium underline underline-offset-2">Go to WhatsApp Settings</Link>}
      />
    );
  }

  if (source === "library") {
    const libraryPageCount = Math.max(1, Math.ceil(filteredLibrary.length / PAGE_SIZE));
    const librarySafePage = Math.min(page, libraryPageCount);
    const libraryVisible = filteredLibrary.slice((librarySafePage - 1) * PAGE_SIZE, librarySafePage * PAGE_SIZE);
    const hasLibraryFilters = Boolean(query.trim()) || category !== "ALL" || industry !== "ALL" || favoritesOnly;
    const selectedVariables = selectedLibraryTemplate && Array.isArray(selectedLibraryTemplate.variables) ? selectedLibraryTemplate.variables.filter((value): value is string => typeof value === "string") : [];
    const customisedBody = selectedLibraryTemplate ? selectedVariables.reduce((body, variable, index) => body.replaceAll(`{{${index + 1}}}`, variableValues[variable]?.trim() || `{{${index + 1}}}`), selectedLibraryTemplate.body) : "";

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/20 p-1">
          <Button size="sm" variant="ghost" onClick={() => { setSource("synced"); setQuery(""); setCategory("ALL"); setIndustry("ALL"); setPage(1); }}>My Meta templates</Button>
          <Button size="sm" variant="default" className="gap-1.5"><Library className="h-4 w-4" />StabiFlow Library</Button>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{(library || []).length.toLocaleString()} ready-to-customise templates</p><Badge variant="secondary" className="gap-1 font-normal"><Sparkles className="h-3 w-3" />{libraryIndustries.length} industries</Badge></div>
          <p className="mt-1 text-sm text-muted-foreground">Find a starting point, preview it, copy it and customise it before submitting the final template to Meta for approval.</p>
        </div>
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <div className="grid gap-2 lg:grid-cols-[minmax(320px,1fr)_220px_180px_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search templates or use cases" className="pl-9" />
            </div>
            <select value={industry} onChange={(e) => { setIndustry(e.target.value); setPage(1); }} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="ALL">All industries</option>
              {libraryIndustries.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="ALL">All categories</option><option value="UTILITY">UTILITY</option><option value="MARKETING">MARKETING</option>
            </select>
            <Button type="button" variant={favoritesOnly ? "secondary" : "outline"} size="sm" className="h-10 gap-1.5" onClick={() => { setFavoritesOnly((value) => !value); setPage(1); }}><Heart className={`h-4 w-4 ${favoritesOnly ? "fill-current" : ""}`} />Saved {favorites.size > 0 ? `(${favorites.size})` : ""}</Button>
            {hasLibraryFilters ? <Button variant="ghost" size="sm" className="h-10 gap-1.5" onClick={() => { setQuery(""); setIndustry("ALL"); setCategory("ALL"); setFavoritesOnly(false); setPage(1); }}><X className="h-4 w-4" />Clear</Button> : <div />}
          </div>
          <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">{filteredLibrary.length.toLocaleString()} of {(library || []).length.toLocaleString()} templates</div>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Template</th><th className="px-4 py-2">Industry</th><th className="px-4 py-2">Category</th><th className="px-4 py-2">Message</th><th className="px-4 py-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{libraryVisible.map((t) => <tr key={t.id} className="border-b last:border-b-0 hover:bg-muted/30"><td className="px-4 py-3 font-medium"><button type="button" className="text-left hover:underline" onClick={() => setSelectedLibraryTemplateId(t.id)}>{t.name}</button></td><td className="px-4 py-3 text-muted-foreground">{t.industry}</td><td className="px-4 py-3"><Badge variant="outline">{t.category}</Badge></td><td className="max-w-xl px-4 py-3 text-muted-foreground"><span className="line-clamp-2">{t.body}</span></td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" aria-label={favorites.has(t.id) ? "Remove saved template" : "Save template"} onClick={async () => { await toggleFavorite(t.id); toast.success(favorites.has(t.id) ? "Removed from saved templates" : "Template saved"); }}><Heart className={`h-4 w-4 ${favorites.has(t.id) ? "fill-current" : ""}`} /></Button><Button variant="ghost" size="sm" onClick={() => { setSelectedLibraryTemplateId(t.id); setVariableValues({}); }}>Preview</Button><Button variant="ghost" size="sm" className="gap-1.5" onClick={async () => { await navigator.clipboard.writeText(t.body); toast.success("Template copied"); }}><Copy className="h-4 w-4" />Copy</Button></div></td></tr>)}</tbody>
          </table>
        </div>
        <Dialog open={!!selectedLibraryTemplate} onOpenChange={(open) => { if (!open) { setSelectedLibraryTemplateId(null); setVariableValues({}); } }}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            {selectedLibraryTemplate && (
              <>
                <DialogHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle>{selectedLibraryTemplate.name}</DialogTitle>
                    <Badge variant="outline">{selectedLibraryTemplate.category}</Badge>
                  </div>
                  <DialogDescription>
                    {selectedLibraryTemplate.industry} · {selectedLibraryTemplate.use_case.replaceAll("_", " ")}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="rounded-lg border bg-muted/20 p-4 text-sm leading-6 whitespace-pre-wrap">
                    {customisedBody}
                  </div>

                  {selectedVariables.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedVariables.map((variable, index) => (
                        <label key={variable} className="space-y-1.5">
                          <span className="text-xs font-medium capitalize">
                            {variable.replaceAll("_", " ")}{" "}
                            <span className="text-muted-foreground">({`{{${index + 1}}}`})</span>
                          </span>
                          <Input
                            value={variableValues[variable] || ""}
                            onChange={(e) => setVariableValues((current) => ({ ...current, [variable]: e.target.value }))}
                            placeholder={`Enter ${variable.replaceAll("_", " ")}`}
                          />
                        </label>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {selectedVariables.length} variables · Meta approval is required before this can be sent as a WhatsApp template.
                  </p>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    variant="outline"
                    className="gap-1.5"
                    onClick={async () => {
                      const wasSaved = favorites.has(selectedLibraryTemplate.id);
                      await toggleFavorite(selectedLibraryTemplate.id);
                      toast.success(wasSaved ? "Removed from saved templates" : "Template saved");
                    }}
                  >
                    <Heart className={`h-4 w-4 ${favorites.has(selectedLibraryTemplate.id) ? "fill-current" : ""}`} />
                    {favorites.has(selectedLibraryTemplate.id) ? "Saved" : "Save"}
                  </Button>
                  <Button
                    className="gap-1.5"
                    onClick={async () => {
                      await navigator.clipboard.writeText(customisedBody);
                      toast.success("Customised template copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                    Use this template
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
        {libraryPageCount > 1 && <div className="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={librarySafePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button><Button variant="outline" size="sm" disabled={librarySafePage >= libraryPageCount} onClick={() => setPage((p) => Math.min(libraryPageCount, p + 1))}>Next</Button></div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/20 p-1">
        <Button size="sm" variant="default">My Meta templates</Button>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { setSource("library"); setQuery(""); setCategory("ALL"); setStatus("ALL"); setPage(1); }}><Library className="h-4 w-4" />StabiFlow Library</Button>
      </div>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{templates.length.toLocaleString()} synced template{templates.length === 1 ? "" : "s"}</p>
            <Badge variant="secondary" className="gap-1 font-normal">
              <CheckCircle2 className="h-3 w-3" />
              {approvedCount.toLocaleString()} approved
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Browse the templates synced from your Meta WhatsApp Business account.</p>
        </div>
        <Button asChild variant="outline" size="sm"><Link to="/app/whatsapp/settings">Refresh from Meta</Link></Button>
      </div>

      <div className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="grid gap-2 lg:grid-cols-[minmax(320px,1fr)_200px_200px_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); resetPage(); }}
            placeholder="Search name, language or message"
            className="pl-9"
            aria-label="Search templates"
          />
        </div>
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); resetPage(); }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Filter templates by category"
        >
          <option value="ALL">All categories</option>
          {categories.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); resetPage(); }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Filter templates by status"
        >
          <option value="ALL">All statuses</option>
          {statuses.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 gap-1.5 px-3 text-muted-foreground"
            onClick={() => { setQuery(""); setCategory("ALL"); setStatus("ALL"); setPage(1); }}
          >
            <X className="h-4 w-4" />
            Clear
          </Button>
        ) : <div />}
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
          <span>{filtered.length.toLocaleString()} of {templates.length.toLocaleString()} template{templates.length === 1 ? "" : "s"}</span>
          {pageCount > 1 && <span>Page {safePage.toLocaleString()} of {pageCount.toLocaleString()}</span>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">WhatsApp message templates</caption>
          <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Name</th>
              <th scope="col" className="px-4 py-2 font-medium">Language</th>
              <th scope="col" className="px-4 py-2 font-medium">Category</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
              <th scope="col" className="px-4 py-2 font-medium">Body</th>
              <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.id} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium">
                  <button type="button" className="block max-w-[280px] truncate text-left hover:underline" title={t.name} onClick={() => setSelectedMetaTemplateId(t.id)}>{t.name}</button>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{t.language}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{t.category || "—"}</td>
                <td className="px-4 py-2.5"><Badge variant={statusTone(t.provider_status)}>{t.provider_status}</Badge></td>
                <td className="max-w-md px-4 py-2.5 text-muted-foreground"><span className="line-clamp-2">{whatsappTemplateBody(t)}</span></td>
                <td className="px-4 py-2.5 text-right"><Button variant="ghost" size="sm" onClick={() => setSelectedMetaTemplateId(t.id)}>Preview</Button></td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No templates match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!selectedMetaTemplate} onOpenChange={(open) => { if (!open) setSelectedMetaTemplateId(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {selectedMetaTemplate && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>{selectedMetaTemplate.name}</DialogTitle>
                  <Badge variant={statusTone(selectedMetaTemplate.provider_status)}>{selectedMetaTemplate.provider_status}</Badge>
                </div>
                <DialogDescription>
                  {selectedMetaTemplate.language} · {selectedMetaTemplate.category || "Uncategorised"}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border bg-muted/20 p-4 text-sm leading-6 whitespace-pre-wrap">
                {whatsappTemplateBody(selectedMetaTemplate)}
              </div>
              <DialogFooter>
                <Button
                  className="gap-1.5"
                  onClick={async () => {
                    await navigator.clipboard.writeText(whatsappTemplateBody(selectedMetaTemplate));
                    toast.success("Template copied");
                  }}
                >
                  <Copy className="h-4 w-4" />
                  Copy template
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
          <Button variant="outline" size="sm" disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</Button>
        </div>
      )}
    </div>
  );
}
