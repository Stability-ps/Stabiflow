import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { LegalMarkdown } from "@/components/legal/LegalMarkdown";
import { LEGAL_DOCUMENTS, type LegalDocumentType } from "@/lib/legal";
import { operatorAdmin, type AdminSetting } from "@/lib/operatorAdmin";
import { ErrorState } from "@/components/admin/AdminPrimitives";

type LegalDoc = {
  id: string; document_type: LegalDocumentType; version: string; title: string; body: string; change_summary: string | null;
  effective_at: string; status: "draft" | "published" | "superseded"; published_at: string | null; updated_at: string;
};
type LegalData = {
  documents: LegalDoc[];
  currentVersions: { document_type: string; current_version: string; effective_at: string }[];
  acceptanceStats: { document_type: string; document_version: string; acceptances: number; last_accepted_at: string }[];
};

const d = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "-");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

// -- Public content ------------------------------------------------------------------

function useSaveSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; value: unknown }) => operatorAdmin("update_setting", { setting: v }),
    onSuccess: () => {
      toast.success("Saved - live on the site now");
      qc.invalidateQueries({ queryKey: ["op-settings"] });
      qc.invalidateQueries({ queryKey: ["public-platform-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function ContentEditors({ settings }: { settings: Record<string, unknown> }) {
  const save = useSaveSetting();
  const hero = obj(settings["content.home_hero"]);
  const [heroTitle, setHeroTitle] = useState(str(hero.title));
  const [heroSubtitle, setHeroSubtitle] = useState(str(hero.subtitle));
  const [pricingIntro, setPricingIntro] = useState(str(obj(settings["content.pricing_intro"]).text));
  const [faq, setFaq] = useState<{ question: string; answer: string }[]>(
    Array.isArray(settings["content.faq"]) ? (settings["content.faq"] as { question: string; answer: string }[]).map((f) => ({ question: str(f.question), answer: str(f.answer) })) : [],
  );
  const support = obj(settings["support.contact"]);
  const [supportEmail, setSupportEmail] = useState(str(support.email));
  const [supportPhone, setSupportPhone] = useState(str(support.phone));
  const [supportWhatsapp, setSupportWhatsapp] = useState(str(support.whatsapp));
  const notice = obj(settings["platform.notice"]);
  const [noticeOn, setNoticeOn] = useState(notice.enabled === true);
  const [noticeMsg, setNoticeMsg] = useState(str(notice.message));
  const [noticeTone, setNoticeTone] = useState(str(notice.tone) || "info");
  const nul = (s: string) => (s.trim() ? s.trim() : null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Home page headline</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input aria-label="Headline" value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} maxLength={120} />
          <Textarea aria-label="Subtitle" value={heroSubtitle} onChange={(e) => setHeroSubtitle(e.target.value)} maxLength={300} rows={2} />
          <Button size="sm" onClick={() => save.mutate({ key: "content.home_hero", value: { title: heroTitle.trim(), subtitle: heroSubtitle.trim() } })}>Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pricing page</CardTitle><CardDescription>Prices and plan benefits are edited under Plans &amp; pricing.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="pl-intro">Intro text</Label>
          <Textarea id="pl-intro" value={pricingIntro} onChange={(e) => setPricingIntro(e.target.value)} maxLength={400} rows={2} />
          <Button size="sm" onClick={() => save.mutate({ key: "content.pricing_intro", value: { text: pricingIntro.trim() } })}>Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">FAQs</CardTitle><CardDescription>Shown on the public pricing page.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {faq.map((f, i) => (
            <div key={i} className="space-y-1 rounded-md border p-2">
              <div className="flex gap-2">
                <Input aria-label={`Question ${i + 1}`} value={f.question} onChange={(e) => setFaq((x) => x.map((y, j) => (j === i ? { ...y, question: e.target.value } : y)))} placeholder="Question" />
                <Button size="icon" variant="ghost" aria-label={`Remove question ${i + 1}`} onClick={() => setFaq((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <Textarea aria-label={`Answer ${i + 1}`} value={f.answer} onChange={(e) => setFaq((x) => x.map((y, j) => (j === i ? { ...y, answer: e.target.value } : y)))} placeholder="Answer" rows={2} />
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setFaq((x) => [...x, { question: "", answer: "" }])}><Plus className="mr-1 h-4 w-4" /> Add question</Button>
            <Button size="sm" onClick={() => save.mutate({ key: "content.faq", value: faq.filter((f) => f.question.trim() && f.answer.trim()).map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })) })}>Save FAQs</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Support contact</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="Support email" placeholder="Email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} />
          <Input aria-label="Support phone" placeholder="Phone" value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} />
          <Input aria-label="Support WhatsApp" placeholder="WhatsApp" value={supportWhatsapp} onChange={(e) => setSupportWhatsapp(e.target.value)} />
          <Button size="sm" className="sm:col-span-3 sm:w-fit" onClick={() => save.mutate({ key: "support.contact", value: { email: nul(supportEmail), phone: nul(supportPhone), whatsapp: nul(supportWhatsapp) } })}>Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Platform notice</CardTitle><CardDescription>A banner shown to every signed-in user.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2"><Checkbox id="pn-on" checked={noticeOn} onCheckedChange={(v) => setNoticeOn(!!v)} /><Label htmlFor="pn-on">Show notice</Label></div>
          <Input aria-label="Notice message" value={noticeMsg} onChange={(e) => setNoticeMsg(e.target.value)} maxLength={400} />
          <Select value={noticeTone} onValueChange={setNoticeTone}>
            <SelectTrigger className="w-40" aria-label="Notice tone"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="info">Information</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent>
          </Select>
          <Button size="sm" onClick={() => save.mutate({ key: "platform.notice", value: { enabled: noticeOn, message: noticeMsg.trim(), tone: noticeTone } })}>Save</Button>
        </CardContent>
      </Card>
    </div>
  );
}

// -- Legal documents -------------------------------------------------------------------

function LegalEditor({ type, data, onChanged }: { type: LegalDocumentType; data: LegalData; onChanged: () => void }) {
  const meta = LEGAL_DOCUMENTS.find((x) => x.type === type)!;
  const docs = data.documents.filter((x) => x.document_type === type);
  const published = docs.find((x) => x.status === "published");
  const draft = docs.find((x) => x.status === "draft");
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState(() => ({
    id: draft?.id ?? null,
    title: draft?.title ?? published?.title ?? meta.title,
    version: draft?.version ?? today,
    effective_at: (draft?.effective_at ?? new Date().toISOString()).slice(0, 10),
    change_summary: draft?.change_summary ?? "",
    body: draft?.body ?? published?.body ?? "",
  }));
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(false);
  const onError = (e: Error) => toast.error(e.message);

  const saveDraft = useMutation({
    mutationFn: () => operatorAdmin<{ document: LegalDoc }>("save_legal_draft", { document: { ...form, document_type: type } }),
    onSuccess: (r) => {
      setForm((f) => ({ ...f, id: r.document.id }));
      toast.success("Draft saved - not visible to the public yet");
      onChanged();
    },
    onError,
  });
  const publish = useMutation({
    mutationFn: () => operatorAdmin("publish_legal", { document_id: form.id, reason }),
    onSuccess: () => {
      toast.success(`${meta.title} version ${form.version} is now live`);
      onChanged();
    },
    onError,
  });
  const del = useMutation({
    mutationFn: () => operatorAdmin("delete_legal_draft", { document_id: form.id }),
    onSuccess: () => {
      toast.success("Draft deleted");
      onChanged();
    },
    onError,
  });

  const stats = data.acceptanceStats.filter((s) => s.document_type === type);
  const current = data.currentVersions.find((v) => v.document_type === type);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {meta.title}
            {published ? <Badge>Live: version {published.version}</Badge> : <Badge variant="outline">{meta.acceptanceTracked || type === "data_deletion" ? "Using the built-in page" : "Not published"}</Badge>}
            {meta.acceptanceTracked && <Badge variant="secondary">Acceptance tracked</Badge>}
          </CardTitle>
          <CardDescription>
            Public page: /legal/{meta.slug}
            {current && ` · accepted version on record: ${current.current_version}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1"><Label htmlFor="lg-title">Title</Label><Input id="lg-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="lg-version">Version</Label><Input id="lg-version" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="lg-eff">Effective date</Label><Input id="lg-eff" type="date" value={form.effective_at} onChange={(e) => setForm({ ...form, effective_at: e.target.value })} /></div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lg-summary">What changed (shown in admin history)</Label>
            <Input id="lg-summary" value={form.change_summary} onChange={(e) => setForm({ ...form, change_summary: e.target.value })} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="lg-body">Text</Label>
              <Button size="sm" variant="ghost" onClick={() => setPreview((p) => !p)}>{preview ? "Edit" : "Preview"}</Button>
            </div>
            {preview ? (
              <div className="prose prose-sm max-w-none space-y-3 rounded-md border p-4 text-sm [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5"><LegalMarkdown source={form.body} /></div>
            ) : (
              <Textarea id="lg-body" className="font-mono text-xs" rows={16} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            )}
            <p className="text-xs text-muted-foreground">Formatting: "## Heading", "- bullet", **bold**, [link text](https://...). A blank line starts a new paragraph.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}>Save draft</Button>
            {form.id && (
              <>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button size="sm" variant="default">Publish…</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Publish {meta.title} version {form.version}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        It goes live on /legal/{meta.slug} immediately and can't be edited afterwards (publish a new version to change it).
                        {meta.acceptanceTracked && " Signed-in users who accepted an earlier version will be asked to accept this one."}
                        {" "}Save your latest edits as a draft first.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input placeholder="Reason (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction disabled={reason.trim().length < 3} onClick={() => publish.mutate()}>Publish</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button size="sm" variant="ghost" onClick={() => del.mutate()}>Delete draft</Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Publication history</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {docs.filter((x) => x.status !== "draft").length === 0 && <p className="text-muted-foreground">No versions published yet.</p>}
          {docs.filter((x) => x.status !== "draft").map((x) => {
            const s = stats.find((st) => st.document_version === x.version);
            return (
              <p key={x.id}>
                Version <span className="font-medium">{x.version}</span> · effective {d(x.effective_at)} · published {d(x.published_at)} · {x.status}
                {x.change_summary ? ` · ${x.change_summary}` : ""}
                {meta.acceptanceTracked ? ` · ${s?.acceptances ?? 0} acceptances` : ""}
              </p>
            );
          })}
          {meta.acceptanceTracked && stats.filter((s) => !docs.some((x) => x.version === s.document_version)).map((s) => (
            <p key={s.document_version} className="text-muted-foreground">Built-in version {s.document_version} · {s.acceptances} acceptances</p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function OperatorPagesLegal() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["op-settings"], queryFn: () => operatorAdmin<{ settings: AdminSetting[] }>("list_settings") });
  const legal = useQuery({ queryKey: ["op-legal"], queryFn: () => operatorAdmin<LegalData>("list_legal") });
  const [type, setType] = useState<LegalDocumentType>("terms_of_service");
  if (settings.isLoading || legal.isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!settings.data || !legal.data) return <ErrorState error={settings.error ?? legal.error} onRetry={() => { void settings.refetch(); void legal.refetch(); }} />;
  const map = Object.fromEntries(settings.data.settings.map((s) => [s.key, s.value]));
  const draftKey = legal.data.documents.find((x) => x.document_type === type && x.status === "draft")?.updated_at ?? "none";
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-2">
        <h2 className="text-title-card text-foreground">Public pages</h2>
        <ContentEditors settings={map} />
      </section>
      <section className="space-y-2">
        <h2 className="text-title-card text-foreground">Policies and legal</h2>
        <Select value={type} onValueChange={(v) => setType(v as LegalDocumentType)}>
          <SelectTrigger aria-label="Document"><SelectValue /></SelectTrigger>
          <SelectContent>{LEGAL_DOCUMENTS.map((x) => <SelectItem key={x.type} value={x.type}>{x.title}</SelectItem>)}</SelectContent>
        </Select>
        <LegalEditor key={`${type}:${draftKey}`} type={type} data={legal.data} onChanged={() => qc.invalidateQueries({ queryKey: ["op-legal"] })} />
      </section>
    </div>
  );
}
