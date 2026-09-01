import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ClipboardList, Plus, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useWhatsAppOutlet } from "@/pages/dashboard/whatsapp/whatsappOutlet";
import { useIntakeSchemas } from "@/hooks/useIntakeSchemas";
import {
  createIntakeField, createIntakeSchema, deleteIntakeField, deleteIntakeSchema, type IntakeFieldRow,
  reorderIntakeFields, setDefaultIntakeSchema, setNumberIntakeSchema, updateIntakeField, updateIntakeSchema,
} from "@/lib/intake";
import { INTAKE_FIELD_TYPE_LABELS, INTAKE_FIELD_TYPES, type IntakeFieldType } from "@/lib/intakeSchema";

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([0-9])/, "f_$1").slice(0, 64);
}

type FieldDraft = {
  id: string | null;
  key: string;
  label: string;
  question_text: string;
  field_type: IntakeFieldType;
  required: boolean;
  help_text: string;
  options: string;
};

const EMPTY_DRAFT: FieldDraft = { id: null, key: "", label: "", question_text: "", field_type: "text", required: true, help_text: "", options: "" };

export default function WhatsAppIntake() {
  const { workspaceId, numbers } = useWhatsAppOutlet();
  const { currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canManage = roleHasPermission(role, "intake.manage");
  const canView = roleHasPermission(role, "intake.view");

  const queryClient = useQueryClient();
  const { data, isLoading } = useIntakeSchemas(canView ? workspaceId : null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["intake-schemas", workspaceId] });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [draft, setDraft] = useState<FieldDraft>(EMPTY_DRAFT);
  const [keyTouched, setKeyTouched] = useState(false);

  const schemas = useMemo(() => data?.schemas ?? [], [data?.schemas]);
  const selected = useMemo(() => schemas.find((s) => s.id === selectedId) ?? schemas[0] ?? null, [schemas, selectedId]);
  const fields = useMemo(
    () => (data?.fields ?? []).filter((f) => f.schema_id === selected?.id).sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key)),
    [data?.fields, selected?.id],
  );

  if (!canView) {
    return <EmptyState icon={ClipboardList} title="Intake" description="You don't have permission to view this workspace's intake configuration." />;
  }
  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  const guard = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSchema = () =>
    guard(async () => {
      const res = await createIntakeSchema(workspaceId, { name: `Intake schema ${schemas.length + 1}` });
      setSelectedId(res.schema_id);
      toast.success("Schema created");
    });

  const openNewField = () => { setDraft(EMPTY_DRAFT); setKeyTouched(false); setFieldDialogOpen(true); };
  const openEditField = (f: IntakeFieldRow) => {
    setDraft({
      id: f.id, key: f.key, label: f.label, question_text: f.question_text, field_type: f.field_type,
      required: f.required, help_text: f.help_text ?? "", options: (f.config?.options ?? []).join(", "),
    });
    setKeyTouched(true);
    setFieldDialogOpen(true);
  };

  const saveField = () =>
    guard(async () => {
      if (!selected) return;
      const isSelect = draft.field_type === "single_select" || draft.field_type === "multi_select";
      const options = isSelect ? draft.options.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const config = options && options.length ? { options } : undefined;
      if (draft.id) {
        await updateIntakeField(workspaceId, draft.id, {
          label: draft.label, questionText: draft.question_text, fieldType: draft.field_type,
          required: draft.required, helpText: draft.help_text || null, config,
        });
      } else {
        await createIntakeField(workspaceId, {
          schemaId: selected.id, key: draft.key || slugify(draft.label), label: draft.label, questionText: draft.question_text,
          fieldType: draft.field_type, required: draft.required, sortOrder: (fields.length + 1) * 10, helpText: draft.help_text || undefined, config,
        });
      }
      setFieldDialogOpen(false);
      toast.success(draft.id ? "Field updated" : "Field added");
    });

  const move = (index: number, dir: -1 | 1) =>
    guard(async () => {
      if (!selected) return;
      const next = fields.slice();
      const target = index + dir;
      if (target < 0 || target >= next.length) return;
      [next[index], next[target]] = [next[target], next[index]];
      await reorderIntakeFields(workspaceId, selected.id, next.map((f) => f.id));
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Intake</h2>
          <p className="text-sm text-muted-foreground">
            Define what StabiFlow must collect before an enquiry is qualified. The AI extracts these answers from a WhatsApp
            conversation, asks the next missing one, and fires <code className="text-xs">conversation.intake_completed</code> when they're all in.
          </p>
        </div>
        {canManage && <Button size="sm" onClick={handleCreateSchema} disabled={busy}><Plus className="mr-1.5 h-4 w-4" /> New schema</Button>}
      </div>

      {schemas.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No intake schema configured"
          description="Create one if you want StabiFlow to automatically qualify enquiries and identify missing information. Until then, WhatsApp AI keeps working with its normal conversation logic."
          action={canManage ? <Button onClick={handleCreateSchema} disabled={busy}>Create a schema</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <div className="space-y-1">
            {schemas.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`flex w-full flex-col items-start gap-0.5 rounded-md border p-2 text-left text-sm transition-colors ${
                  selected?.id === s.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <span className="font-medium">{s.name}</span>
                <span className="flex flex-wrap gap-1">
                  {s.is_default && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
                  {!s.is_active && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                  <span className="text-[11px] text-muted-foreground">
                    {(data?.fields ?? []).filter((f) => f.schema_id === s.id).length} field(s)
                  </span>
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{selected.name}</CardTitle>
                {canManage && (
                  <div className="flex flex-wrap gap-1.5">
                    {!selected.is_default && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => guard(async () => { await setDefaultIntakeSchema(workspaceId, selected.id); toast.success("Set as default"); })}>
                        <Star className="mr-1 h-3.5 w-3.5" /> Set default
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => guard(async () => { await updateIntakeSchema(workspaceId, selected.id, { is_active: !selected.is_active }); toast.success(selected.is_active ? "Deactivated" : "Activated"); })}>
                      {selected.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() => guard(async () => { await deleteIntakeSchema(workspaceId, selected.id); setSelectedId(null); toast.success("Schema deleted"); })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {canManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      defaultValue={selected.name}
                      key={selected.id + selected.name}
                      className="h-8 max-w-xs text-sm"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== selected.name) guard(async () => { await updateIntakeSchema(workspaceId, selected.id, { name: v }); });
                      }}
                    />
                    <Button size="sm" variant="outline" onClick={openNewField} disabled={busy}><Plus className="mr-1 h-3.5 w-3.5" /> Add field</Button>
                  </div>
                )}

                {fields.length === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    No fields yet. Add the questions this schema should collect - order matters: the AI asks them top to bottom.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Order</th>
                          <th className="px-3 py-2 font-medium">Label / key</th>
                          <th className="px-3 py-2 font-medium">Type</th>
                          <th className="px-3 py-2 font-medium">Required</th>
                          <th className="px-3 py-2 font-medium">Question</th>
                          {canManage && <th className="px-3 py-2 font-medium sr-only">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((f, i) => (
                          <tr key={f.id} className={`border-b last:border-b-0 ${f.is_active === false ? "opacity-50" : ""}`}>
                            <td className="px-3 py-2">
                              {canManage ? (
                                <span className="flex gap-0.5">
                                  <button aria-label="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 hover:bg-muted disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                                  <button aria-label="Move down" disabled={busy || i === fields.length - 1} onClick={() => move(i, 1)} className="rounded p-0.5 hover:bg-muted disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                                </span>
                              ) : i + 1}
                            </td>
                            <td className="px-3 py-2">
                              <span className="block font-medium">{f.label}</span>
                              <code className="text-[11px] text-muted-foreground">{f.key}</code>
                            </td>
                            <td className="px-3 py-2">{INTAKE_FIELD_TYPE_LABELS[f.field_type]}</td>
                            <td className="px-3 py-2">{f.required ? <Badge variant="secondary" className="text-[10px]">Required</Badge> : <span className="text-xs text-muted-foreground">Optional</span>}</td>
                            <td className="px-3 py-2 text-muted-foreground">{f.question_text}</td>
                            {canManage && (
                              <td className="px-3 py-2">
                                <span className="flex justify-end gap-1">
                                  <Button size="sm" variant="ghost" className="h-7" onClick={() => openEditField(f)}>Edit</Button>
                                  <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => guard(async () => { await updateIntakeField(workspaceId, f.id, { isActive: f.is_active === false }); })}>
                                    {f.is_active === false ? "Activate" : "Deactivate"}
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 text-destructive" disabled={busy} onClick={() => guard(async () => { await deleteIntakeField(workspaceId, f.id); toast.success("Field removed"); })}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </span>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {canManage && numbers.length > 0 && (
                  <div className="rounded-md border p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Which schema each WhatsApp number uses</p>
                    <div className="space-y-1.5">
                      {numbers.map((n) => (
                        <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span>{n.verified_name || n.display_phone_number || n.phone_number_id}</span>
                          <Select
                            defaultValue={n.intake_schema_id ?? "__default__"}
                            onValueChange={(v) => guard(async () => { await setNumberIntakeSchema(workspaceId, n.id, v === "__default__" ? null : v); toast.success("Number updated"); })}
                          >
                            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__default__">Workspace default</SelectItem>
                              {schemas.filter((s) => s.is_active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Dialog open={fieldDialogOpen} onOpenChange={setFieldDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{draft.id ? "Edit field" : "Add field"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Label</p>
              <Input
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value, key: d.id || keyTouched ? d.key : slugify(e.target.value) }))}
                className="h-8 text-sm"
                placeholder="e.g. Funding amount"
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Key {draft.id && <span className="text-muted-foreground/70">(cannot change)</span>}</p>
              <Input
                value={draft.key}
                onChange={(e) => { setKeyTouched(true); setDraft((d) => ({ ...d, key: slugify(e.target.value) })); }}
                disabled={!!draft.id}
                className="h-8 font-mono text-xs"
                placeholder="funding_amount"
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Type</p>
              <Select value={draft.field_type} onValueChange={(v) => setDraft((d) => ({ ...d, field_type: v as IntakeFieldType }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{INTAKE_FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{INTAKE_FIELD_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {(draft.field_type === "single_select" || draft.field_type === "multi_select") && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Options (comma separated)</p>
                <Input value={draft.options} onChange={(e) => setDraft((d) => ({ ...d, options: e.target.value }))} className="h-8 text-sm" placeholder="Yes, No, Maybe" />
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Question the AI asks</p>
              <Textarea value={draft.question_text} onChange={(e) => setDraft((d) => ({ ...d, question_text: e.target.value }))} className="min-h-[60px] text-sm" placeholder="How much funding do you need?" maxLength={500} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Help text (optional)</p>
              <Input value={draft.help_text} onChange={(e) => setDraft((d) => ({ ...d, help_text: e.target.value }))} className="h-8 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.required} onChange={(e) => setDraft((d) => ({ ...d, required: e.target.checked }))} />
              Required before intake is complete
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFieldDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveField} disabled={busy || !draft.label.trim() || !draft.question_text.trim() || (!draft.id && !draft.key.trim())}>
              {draft.id ? "Save field" : "Add field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
