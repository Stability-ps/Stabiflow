import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useAutomationConditions, useAutomationActions, type AutomationRow } from "@/hooks/useAutomations";
import {
  createAutomation, updateAutomation, ACTION_TYPES, ACTION_TYPE_LABELS, EVENT_TYPES, EVENT_TYPE_LABELS, CONDITION_OPERATORS,
  type AutomationActionInput, type AutomationConditionInput, type AutomationEventType, type AutomationActionType, type ConditionOperator,
} from "@/lib/automations";
import { ActionConfigFields } from "@/pages/dashboard/automations/ActionConfigFields";

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: "is", neq: "is not", gt: "is greater than", gte: "is at least", lt: "is less than", lte: "is at most",
  in: "is one of", not_in: "is not one of", contains: "contains", is_null: "is empty", is_not_null: "is not empty",
};

function parseValue(raw: string): unknown {
  if (raw.trim() === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

// A minimal starter-example pre-fill for the empty-state "Use template"
// buttons - reuses the exact same builder fields a user would fill in by
// hand, never a new persistence mechanism. Only trigger/action TYPES real
// automations already support (see taxonomy.ts).
export type AutomationTemplate = { name: string; triggerEventType: AutomationEventType; actionType: AutomationActionType };

export function AutomationBuilderDialog({ workspaceId, automation, template, open, onClose, onSaved }: {
  workspaceId: string;
  automation: AutomationRow | null; // null = creating a new automation
  template?: AutomationTemplate | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditing = !!automation;
  const { data: existingConditions } = useAutomationConditions(workspaceId, automation?.id ?? null);
  const { data: existingActions } = useAutomationActions(workspaceId, automation?.id ?? null);
  const { data: members } = useWorkspaceMembers(workspaceId);

  const [name, setName] = useState("");
  const [triggerEventType, setTriggerEventType] = useState<AutomationEventType>("lead.created");
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState("60");
  const [conditions, setConditions] = useState<AutomationConditionInput[]>([]);
  const [actions, setActions] = useState<AutomationActionInput[]>([{ action_type: "create_notification", action_config: {} }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (automation) {
      setName(automation.name);
      setTriggerEventType(automation.trigger_event_type);
      setIdleTimeoutMinutes(String(automation.idle_timeout_minutes ?? 60));
    } else if (template) {
      setName(template.name);
      setTriggerEventType(template.triggerEventType);
      setIdleTimeoutMinutes("60");
      setConditions([]);
      setActions([{ action_type: template.actionType, action_config: {} }]);
    } else {
      setName("");
      setTriggerEventType("lead.created");
      setIdleTimeoutMinutes("60");
      setConditions([]);
      setActions([{ action_type: "create_notification", action_config: {} }]);
    }
  }, [open, automation, template]);

  useEffect(() => {
    if (!isEditing) return;
    if (existingConditions) setConditions(existingConditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value })));
  }, [isEditing, existingConditions]);

  useEffect(() => {
    if (!isEditing) return;
    if (existingActions) setActions(existingActions.map((a) => ({ action_type: a.action_type, action_config: a.action_config })));
  }, [isEditing, existingActions]);

  const membersList = (members || []) as { user_id: string; profile: { full_name: string | null } | null }[];

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (actions.length === 0) {
      toast.error("At least one action is required");
      return;
    }
    setSaving(true);
    try {
      if (isEditing) {
        await updateAutomation(workspaceId, automation!.id, {
          name, triggerEventType,
          idleTimeoutMinutes: (triggerEventType === "lead.idle_timeout" || triggerEventType === "conversation.idle_timeout") ? Number(idleTimeoutMinutes) : null,
          conditions, actions,
        });
      } else {
        await createAutomation(workspaceId, {
          name, triggerEventType,
          idleTimeoutMinutes: (triggerEventType === "lead.idle_timeout" || triggerEventType === "conversation.idle_timeout") ? Number(idleTimeoutMinutes) : undefined,
          conditions, actions,
        });
      }
      toast.success(isEditing ? "Automation updated" : "Automation created");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save this automation");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit automation" : "New automation"}</DialogTitle>
          <DialogDescription>Automations run WHEN a trigger event happens, IF conditions match, THEN one or more actions run - through the same rules and permissions as doing it yourself.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Notify sales on new lead" />
          </div>

          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">When</Label>
            <Select value={triggerEventType} onValueChange={(v) => setTriggerEventType(v as AutomationEventType)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((e) => <SelectItem key={e} value={e}>{EVENT_TYPE_LABELS[e]}</SelectItem>)}
              </SelectContent>
            </Select>
            {(triggerEventType === "lead.idle_timeout" || triggerEventType === "conversation.idle_timeout") && (
              <div className="mt-2">
                <Label className="text-xs">Idle for at least (minutes)</Label>
                <Input type="number" min={1} value={idleTimeoutMinutes} onChange={(e) => setIdleTimeoutMinutes(e.target.value)} className="w-32" />
                <p className="mt-1 text-xs text-muted-foreground">
                  {triggerEventType === "conversation.idle_timeout"
                    ? "Measured from the customer's last message. A new message starts the clock over."
                    : "Measured from the lead's last activity."}
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">If (optional)</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConditions([...conditions, { field: "", operator: "eq", value: "" }])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add condition
              </Button>
            </div>
            {conditions.length === 0 && <p className="text-xs text-muted-foreground">No conditions - this automation runs on every matching event.</p>}
            <div className="space-y-2">
              {conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border p-2">
                  <Input className="flex-1" placeholder="Field (e.g. qualification_status)" value={c.field} onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))} />
                  <Select value={c.operator} onValueChange={(v) => setConditions(conditions.map((x, j) => (j === i ? { ...x, operator: v as ConditionOperator } : x)))}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONDITION_OPERATORS.map((op) => <SelectItem key={op} value={op}>{OPERATOR_LABELS[op]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {c.operator !== "is_null" && c.operator !== "is_not_null" && (
                    <Input className="flex-1" placeholder="Value" value={stringifyValue(c.value)} onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, value: parseValue(e.target.value) } : x)))} />
                  )}
                  <Button type="button" variant="ghost" size="icon" onClick={() => setConditions(conditions.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Then</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setActions([...actions, { action_type: "create_notification", action_config: {} }])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add action
              </Button>
            </div>
            <div className="space-y-3">
              {actions.map((a, i) => (
                <div key={i} className="space-y-2 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Select value={a.action_type} onValueChange={(v) => setActions(actions.map((x, j) => (j === i ? { action_type: v as AutomationActionType, action_config: {} } : x)))}>
                      <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{ACTION_TYPE_LABELS[t]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {actions.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => setActions(actions.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                  <ActionConfigFields
                    workspaceId={workspaceId}
                    actionType={a.action_type}
                    config={a.action_config}
                    onChange={(config) => setActions(actions.map((x, j) => (j === i ? { ...x, action_config: config } : x)))}
                    members={membersList}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : isEditing ? "Save changes" : "Create automation"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
