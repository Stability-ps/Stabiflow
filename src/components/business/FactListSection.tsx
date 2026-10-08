import { useState } from "react";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProvenanceBadge } from "@/components/business/ProvenanceBadge";
import {
  confirmBusinessChild, deleteBusinessChild, insertBusinessChild, updateBusinessChild, type BusinessChildTable,
} from "@/lib/businessIdentity";

export type FactField = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "url" | "email";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
};

type Row = Record<string, unknown> & { id: string; source?: string; verification_status?: string };

type Props = {
  title: string;
  description?: string;
  table: BusinessChildTable;
  workspaceId: string;
  userId: string | null;
  rows: Row[];
  fields: FactField[];
  /** Renders the one-line summary of a saved row. */
  summarize: (row: Row) => string;
  canEdit: boolean;
  onChanged: () => void;
  defaults?: Record<string, unknown>;
  sortable?: boolean;
};

function emptyDraft(fields: FactField[], defaults: Record<string, unknown> = {}): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const f of fields) d[f.name] = f.type === "checkbox" ? false : "";
  return { ...d, ...defaults };
}

/** Normalizes form values to DB values ("" -> null, numbers parsed). */
function toDbValues(fields: FactField[], draft: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = draft[f.name];
    if (f.type === "checkbox") out[f.name] = !!v;
    else if (f.type === "number") out[f.name] = v === "" || v === null || v === undefined ? null : Number(v);
    else out[f.name] = typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v;
  }
  return out;
}

/**
 * Generic editor for one list of business facts (contacts, locations,
 * offerings, team, ...). Every saved row shows where it came from and
 * whether the customer has confirmed it; a user edit resets the source to
 * "Entered by you".
 */
export function FactListSection({ title, description, table, workspaceId, userId, rows, fields, summarize, canEdit, onChanged, defaults, sortable = true }: Props) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  function startNew() {
    setDraft(emptyDraft(fields, defaults));
    setEditingId("new");
  }

  function startEdit(row: Row) {
    const d: Record<string, unknown> = {};
    for (const f of fields) d[f.name] = row[f.name] ?? (f.type === "checkbox" ? false : "");
    setDraft(d);
    setEditingId(row.id);
  }

  async function save() {
    const missing = fields.filter((f) => f.required && (draft[f.name] === "" || draft[f.name] === null || draft[f.name] === undefined));
    if (missing.length > 0) {
      toast.error(`${missing[0].label} is required`);
      return;
    }
    setSaving(true);
    try {
      const values = toDbValues(fields, draft);
      if (editingId === "new") {
        // Defaults for keys with no visible field (e.g. an identifier's
        // country_code) are still written on insert.
        const hiddenDefaults = Object.fromEntries(Object.entries(defaults ?? {}).filter(([k]) => !fields.some((f) => f.name === k)));
        await insertBusinessChild(table, { ...hiddenDefaults, ...values, workspace_id: workspaceId, source: "user", ...(sortable ? { sort_order: rows.length } : {}) });
      } else if (editingId) {
        await updateBusinessChild(table, editingId, { ...values, source: "user" });
      }
      setEditingId(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteBusinessChild(table, id);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    }
  }

  async function confirm(id: string) {
    if (!userId) return;
    try {
      await confirmBusinessChild(table, id, userId);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not confirm");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {canEdit && editingId === null && (
          <Button size="sm" variant="outline" onClick={startNew}>
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && editingId !== "new" && <p className="text-sm text-muted-foreground">Nothing added yet.</p>}
        {rows.map((row) =>
          editingId === row.id ? null : (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm">{summarize(row)}</p>
                <ProvenanceBadge source={row.source} status={row.verification_status} className="mt-1" />
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  {row.verification_status === "unverified" && (
                    <Button size="sm" variant="ghost" onClick={() => confirm(row.id)} aria-label={`Confirm ${summarize(row)}`}>
                      <Check className="mr-1 h-4 w-4" /> Confirm
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => startEdit(row)} aria-label={`Edit ${summarize(row)}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(row.id)} aria-label={`Remove ${summarize(row)}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ),
        )}
        {editingId !== null && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => {
                const id = `${table}-${f.name}`;
                const value = draft[f.name];
                if (f.type === "checkbox") {
                  return (
                    <div key={f.name} className="flex items-center gap-2 sm:col-span-2">
                      <Checkbox id={id} checked={!!value} onCheckedChange={(v) => setDraft((d) => ({ ...d, [f.name]: !!v }))} />
                      <Label htmlFor={id}>{f.label}</Label>
                    </div>
                  );
                }
                return (
                  <div key={f.name} className={f.type === "textarea" ? "space-y-1 sm:col-span-2" : "space-y-1"}>
                    <Label htmlFor={id}>
                      {f.label}
                      {f.required ? " *" : ""}
                    </Label>
                    {f.type === "textarea" ? (
                      <Textarea id={id} value={String(value ?? "")} placeholder={f.placeholder} onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.value }))} />
                    ) : f.type === "select" ? (
                      <Select value={String(value ?? "")} onValueChange={(v) => setDraft((d) => ({ ...d, [f.name]: v }))}>
                        <SelectTrigger id={id}>
                          <SelectValue placeholder="Choose..." />
                        </SelectTrigger>
                        <SelectContent>
                          {f.options?.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={id}
                        type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
                        value={String(value ?? "")}
                        placeholder={f.placeholder}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.value }))}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={saving}>
                <X className="mr-1 h-4 w-4" /> Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                Save
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
