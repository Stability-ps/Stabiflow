import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { operatorAdmin, type AdminSetting } from "@/lib/operatorAdmin";
import { useAdmin } from "@/hooks/useAdmin";
import { Plus, Trash2 } from "lucide-react";

type FaqItem = { question: string; answer: string };

function settingLabel(key: string) {
  const labels: Record<string, string> = {
    "billing.grace_days": "Payment grace period",
    "billing.pending_abandon_hours": "Abandoned checkout window",
    "content.home_hero": "Homepage hero",
    "content.pricing_intro": "Pricing page introduction",
    "content.faq": "Public FAQs",
    "support.contact": "Support contact details",
    "platform.notice": "Platform notice banner",
  };
  return labels[key] ?? key.split(".").pop()?.replaceAll("_", " ") ?? key;
}

function settingHint(key: string) {
  const hints: Record<string, string> = {
    "billing.grace_days": "How many days a customer keeps access after an unpaid renewal.",
    "billing.pending_abandon_hours": "How long an unpaid checkout remains pending before StabiFlow treats it as abandoned.",
    "content.home_hero": "The main headline and supporting copy customers see on the public home page.",
    "content.pricing_intro": "Short introduction displayed immediately above the public pricing plans.",
    "content.faq": "Questions and answers shown on the public pricing/help experience.",
    "support.contact": "Customer-facing support details. Leave fields blank if you do not want them displayed.",
    "platform.notice": "Optional platform-wide notice. Turn it on only when there is something customers genuinely need to see.",
  };
  return hints[key];
}

function SettingShell({ setting, children }: { setting: AdminSetting; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="space-y-1 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{settingLabel(setting.key)}</CardTitle>
          <Badge variant={setting.is_public ? "secondary" : "outline"}>
            {setting.is_public ? "Public" : "Internal"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{settingHint(setting.key) ?? setting.description}</p>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 font-mono">{setting.key}</div>
        </details>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SaveRow({ dirty, pending, readOnly, onSave }: { dirty: boolean; pending: boolean; readOnly: boolean; onSave: () => void }) {
  if (readOnly) return <p className="text-xs text-muted-foreground">Read-only: operational settings can be changed by an Admin or the Owner.</p>;
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      <p className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "Up to date"}</p>
      <Button size="sm" onClick={onSave} disabled={!dirty || pending}>{pending ? "Saving..." : "Save changes"}</Button>
    </div>
  );
}

function useSettingSave(setting: AdminSetting, onChanged: () => void) {
  const save = useMutation({
    mutationFn: (value: unknown) => operatorAdmin("update_setting", { setting: { key: setting.key, value } }),
    onSuccess: () => {
      toast.success("Setting saved");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return save;
}

function NumberEditor({ setting, onChanged }: { setting: AdminSetting; onChanged: () => void }) {
  const { can } = useAdmin();
  const readOnly = !setting.is_public && !can("settings.manage");
  const initial = typeof setting.value === "number" ? setting.value : Number(setting.value ?? 0);
  const [value, setValue] = useState(String(initial));
  const save = useSettingSave(setting, onChanged);
  const numeric = Number(value);
  const dirty = Number.isFinite(numeric) && numeric !== initial;

  return (
    <SettingShell setting={setting}>
      <div className="max-w-sm space-y-2">
        <Label htmlFor={setting.key}>Value</Label>
        <Input id={setting.key} type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} readOnly={readOnly} />
      </div>
      <SaveRow dirty={dirty} pending={save.isPending} readOnly={readOnly} onSave={() => save.mutate(numeric)} />
    </SettingShell>
  );
}

function HomeHeroEditor({ setting, onChanged }: { setting: AdminSetting; onChanged: () => void }) {
  const value = (setting.value ?? {}) as Record<string, unknown>;
  const initialTitle = typeof value.title === "string" ? value.title : "";
  const initialSubtitle = typeof value.subtitle === "string" ? value.subtitle : "";
  const [title, setTitle] = useState(initialTitle);
  const [subtitle, setSubtitle] = useState(initialSubtitle);
  const save = useSettingSave(setting, onChanged);
  const dirty = title !== initialTitle || subtitle !== initialSubtitle;

  return (
    <SettingShell setting={setting}>
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="home-hero-title">Headline</Label>
          <Input id="home-hero-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="home-hero-subtitle">Supporting text</Label>
          <Textarea id="home-hero-subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} rows={3} maxLength={320} />
        </div>
      </div>
      <SaveRow dirty={dirty} pending={save.isPending} readOnly={false} onSave={() => save.mutate({ title: title.trim(), subtitle: subtitle.trim() })} />
    </SettingShell>
  );
}

function TextObjectEditor({ setting, onChanged }: { setting: AdminSetting; onChanged: () => void }) {
  const value = (setting.value ?? {}) as Record<string, unknown>;
  const initial = typeof value.text === "string" ? value.text : "";
  const [text, setText] = useState(initial);
  const save = useSettingSave(setting, onChanged);
  return (
    <SettingShell setting={setting}>
      <div className="space-y-2">
        <Label htmlFor={setting.key}>Text</Label>
        <Textarea id={setting.key} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500} />
      </div>
      <SaveRow dirty={text !== initial} pending={save.isPending} readOnly={false} onSave={() => save.mutate({ text: text.trim() })} />
    </SettingShell>
  );
}

function SupportEditor({ setting, onChanged }: { setting: AdminSetting; onChanged: () => void }) {
  const value = (setting.value ?? {}) as Record<string, unknown>;
  const initial = {
    email: typeof value.email === "string" ? value.email : "",
    phone: typeof value.phone === "string" ? value.phone : "",
    whatsapp: typeof value.whatsapp === "string" ? value.whatsapp : "",
  };
  const [draft, setDraft] = useState(initial);
  const save = useSettingSave(setting, onChanged);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  return (
    <SettingShell setting={setting}>
      <div className="grid gap-4 md:grid-cols-3">
        {(["email", "phone", "whatsapp"] as const).map((field) => (
          <div key={field} className="space-y-2">
            <Label htmlFor={`support-${field}`} className="capitalize">{field}</Label>
            <Input id={`support-${field}`} value={draft[field]} onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))} placeholder={field === "email" ? "support@stabiflow.com" : "+27..."} />
          </div>
        ))}
      </div>
      <SaveRow dirty={dirty} pending={save.isPending} readOnly={false} onSave={() => save.mutate({
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        whatsapp: draft.whatsapp.trim() || null,
      })} />
    </SettingShell>
  );
}

function NoticeEditor({ setting, onChanged }: { setting: AdminSetting; onChanged: () => void }) {
  const value = (setting.value ?? {}) as Record<string, unknown>;
  const initial = {
    enabled: value.enabled === true,
    tone: typeof value.tone === "string" ? value.tone : "info",
    message: typeof value.message === "string" ? value.message : "",
  };
  const [draft, setDraft] = useState(initial);
  const save = useSettingSave(setting, onChanged);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  return (
    <SettingShell setting={setting}>
      <div className="grid gap-4">
        <div className="flex items-center justify-between rounded-lg border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Show notice</p>
            <p className="text-xs text-muted-foreground">Customers will only see the banner while this is enabled.</p>
          </div>
          <button type="button" role="switch" aria-checked={draft.enabled} onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))} className={`relative h-6 w-11 rounded-full border transition-colors ${draft.enabled ? "bg-primary" : "bg-muted"}`} aria-label="Enable platform notice"><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${draft.enabled ? "left-5" : "left-0.5"}`} /></button>
        </div>
        <div className="grid gap-4 md:grid-cols-[180px_1fr]">
          <div className="space-y-2">
            <Label htmlFor="notice-tone">Tone</Label>
            <select id="notice-tone" value={draft.tone} onChange={(e) => setDraft((d) => ({ ...d, tone: e.target.value }))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="info">Information</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notice-message">Message</Label>
            <Input id="notice-message" value={draft.message} onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))} maxLength={280} placeholder="Scheduled maintenance tonight from 22:00..." />
          </div>
        </div>
      </div>
      <SaveRow dirty={dirty} pending={save.isPending} readOnly={false} onSave={() => save.mutate({ ...draft, message: draft.message.trim() })} />
    </SettingShell>
  );
}

function FaqEditor({ setting, onChanged }: { setting: AdminSetting; onChanged: () => void }) {
  const initial = useMemo<FaqItem[]>(() => Array.isArray(setting.value)
    ? setting.value.map((item) => {
        const row = (item ?? {}) as Record<string, unknown>;
        return { question: typeof row.question === "string" ? row.question : "", answer: typeof row.answer === "string" ? row.answer : "" };
      })
    : [], [setting.value]);
  const [items, setItems] = useState<FaqItem[]>(initial);
  const save = useSettingSave(setting, onChanged);
  const dirty = JSON.stringify(items) !== JSON.stringify(initial);

  return (
    <SettingShell setting={setting}>
      <div className="space-y-3">
        {items.length === 0 ? <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No FAQs yet. Add the first question below.</div> : null}
        {items.map((item, index) => (
          <div key={index} className="rounded-xl border p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">FAQ {index + 1}</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))}><Trash2 className="mr-1 h-4 w-4" />Remove</Button>
            </div>
            <div className="grid gap-3">
              <div className="space-y-2">
                <Label htmlFor={`faq-q-${index}`}>Question</Label>
                <Input id={`faq-q-${index}`} value={item.question} onChange={(e) => setItems((rows) => rows.map((r, i) => i === index ? { ...r, question: e.target.value } : r))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`faq-a-${index}`}>Answer</Label>
                <Textarea id={`faq-a-${index}`} rows={3} value={item.answer} onChange={(e) => setItems((rows) => rows.map((r, i) => i === index ? { ...r, answer: e.target.value } : r))} />
              </div>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setItems((rows) => [...rows, { question: "", answer: "" }])}><Plus className="mr-1 h-4 w-4" />Add FAQ</Button>
      </div>
      <SaveRow dirty={dirty} pending={save.isPending} readOnly={false} onSave={() => save.mutate(items.map((item) => ({ question: item.question.trim(), answer: item.answer.trim() })).filter((item) => item.question && item.answer))} />
    </SettingShell>
  );
}

function AdvancedJsonEditor({ setting, onChanged }: { setting: AdminSetting; onChanged: () => void }) {
  const { can } = useAdmin();
  const readOnly = !setting.is_public && !can("settings.manage");
  const initial = JSON.stringify(setting.value, null, 2);
  const [draft, setDraft] = useState(initial);
  const save = useSettingSave(setting, onChanged);
  const dirty = draft !== initial;

  return (
    <SettingShell setting={setting}>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Advanced JSON editor</summary>
        <div className="mt-3 space-y-2">
          <Textarea className="font-mono text-xs" rows={Math.min(12, draft.split("\n").length + 1)} value={draft} onChange={(e) => setDraft(e.target.value)} readOnly={readOnly} />
          <SaveRow dirty={dirty} pending={save.isPending} readOnly={readOnly} onSave={() => {
            try { save.mutate(JSON.parse(draft)); }
            catch { toast.error("Value must be valid JSON"); }
          }} />
        </div>
      </details>
    </SettingShell>
  );
}

function SettingEditor({ setting, onChanged }: { setting: AdminSetting; onChanged: () => void }) {
  switch (setting.key) {
    case "billing.grace_days":
    case "billing.pending_abandon_hours":
      return <NumberEditor setting={setting} onChanged={onChanged} />;
    case "content.home_hero":
      return <HomeHeroEditor setting={setting} onChanged={onChanged} />;
    case "content.pricing_intro":
      return <TextObjectEditor setting={setting} onChanged={onChanged} />;
    case "content.faq":
      return <FaqEditor setting={setting} onChanged={onChanged} />;
    case "support.contact":
      return <SupportEditor setting={setting} onChanged={onChanged} />;
    case "platform.notice":
      return <NoticeEditor setting={setting} onChanged={onChanged} />;
    default:
      return <AdvancedJsonEditor setting={setting} onChanged={onChanged} />;
  }
}

/**
 * Owner-friendly platform settings and public copy. Known settings are presented
 * as business forms; unknown future keys retain an advanced JSON fallback.
 */
export function OperatorSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["op-settings"], queryFn: () => operatorAdmin<{ settings: AdminSetting[] }>("list_settings") });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading settings...</p>;
  if (q.error || !q.data) return <p className="text-sm text-destructive">Could not load settings.</p>;

  const groups = q.data.settings.reduce<Record<string, AdminSetting[]>>((acc, s) => {
    const g = s.key.split(".")[0];
    (acc[g] ||= []).push(s);
    return acc;
  }, {});

  const names: Record<string, { title: string; description: string }> = {
    billing: { title: "Billing rules", description: "Operational timing used by subscription and checkout workflows." },
    content: { title: "Public content", description: "Copy customers see on StabiFlow's public pages." },
    support: { title: "Customer support", description: "Public contact details customers can use when they need help." },
    platform: { title: "Platform notices", description: "Temporary platform-wide customer notices and announcements." },
  };

  return (
    <div className="space-y-8">
      {Object.entries(groups).map(([group, settings]) => {
        const meta = names[group] ?? { title: group.replaceAll("_", " "), description: "Platform configuration." };
        return (
          <section key={group} className="space-y-3">
            <div>
              <h2 className="text-base font-semibold capitalize">{meta.title}</h2>
              <p className="text-sm text-muted-foreground">{meta.description}</p>
            </div>
            <div className="grid gap-4">
              {settings.map((s) => (
                <SettingEditor key={`${s.key}:${s.updated_at}`} setting={s} onChanged={() => qc.invalidateQueries({ queryKey: ["op-settings"] })} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
