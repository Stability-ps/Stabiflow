import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePipelines, usePipelineStages } from "@/hooks/useLeads";
import { useInboxTemplates, approvedTemplates } from "@/hooks/useInboxTemplates";
import type { AutomationActionType } from "@/lib/automations";

type Member = { user_id: string; profile: { full_name: string | null } | null };

// WHEN/IF/THEN builder's THEN row - a small, controlled config form per
// action_type (never a raw JSON textarea) so a workspace admin configuring
// an automation can only ever produce a well-shaped action_config, the same
// way the condition row only ever produces a valid operator. Every field
// here maps 1:1 to what dispatchAction (automations/actionDispatch.ts)
// actually reads for that action_type - see ACTION_TYPE_LABELS for what
// each does. Fields left blank default to the triggering event's own
// entity ($event.entity_id) server-side - see actionDispatch.ts.
export function ActionConfigFields({ workspaceId, actionType, config, onChange, members }: {
  workspaceId: string;
  actionType: AutomationActionType;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  members: Member[];
}) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const pipelineId = (config.pipeline_id as string) || "";
  const { data: pipelines } = usePipelines(workspaceId);
  const { data: stages } = usePipelineStages(workspaceId, pipelineId || null);
  const { data: allTemplates } = useInboxTemplates(workspaceId);
  const templates = approvedTemplates(allTemplates);

  if (actionType === "set_conversation_priority") {
    return (
      <div>
        <Label className="text-xs">Priority</Label>
        <Select value={(config.priority as string) || ""} onValueChange={(v) => set("priority", v)}>
          <SelectTrigger><SelectValue placeholder="Choose a priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (actionType === "set_conversation_handoff") {
    return <p className="text-xs text-muted-foreground">Turns AI off for this conversation and hands it to your team, exactly like a staff takeover. Starts the human-response SLA clock.</p>;
  }

  if (actionType === "add_tag") {
    return (
      <div>
        <Label className="text-xs">Tag</Label>
        <Input value={(config.tag as string) || ""} onChange={(e) => set("tag", e.target.value)} placeholder="e.g. needs-review" maxLength={60} />
      </div>
    );
  }

  if (actionType === "send_whatsapp_template" || actionType === "request_document") {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Approved WhatsApp template</Label>
          <Select value={(config.template_id as string) || ""} onValueChange={(v) => set("template_id", v)}>
            <SelectTrigger><SelectValue placeholder={templates.length ? "Choose a template" : "No approved templates yet"} /></SelectTrigger>
            <SelectContent>
              {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Template values (comma-separated, in order)</Label>
          <Input value={(config.parameters as string) || ""} onChange={(e) => set("parameters", e.target.value)} placeholder="Optional - e.g. Acme, invoice" />
        </div>
        {actionType === "request_document" && (
          <div>
            <Label className="text-xs">Intake field (optional)</Label>
            <Input value={(config.field_key as string) || ""} onChange={(e) => set("field_key", e.target.value)} placeholder="e.g. proof_of_address" />
            <p className="mt-1 text-xs text-muted-foreground">If set, must be a field in the conversation's intake schema.</p>
          </div>
        )}
      </div>
    );
  }

  if (actionType === "create_lead") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Contact name</Label>
          <Input value={(config.contact_name as string) || ""} onChange={(e) => set("contact_name", e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <Label className="text-xs">Source</Label>
          <Input value={(config.source as string) || "automation"} onChange={(e) => set("source", e.target.value)} />
        </div>
      </div>
    );
  }

  if (actionType === "assign_lead" || actionType === "assign_opportunity") {
    return (
      <div>
        <Label className="text-xs">Assign to</Label>
        <Select value={(config.staff_id as string) || ""} onValueChange={(v) => set("staff_id", v)}>
          <SelectTrigger><SelectValue placeholder="Choose a team member" /></SelectTrigger>
          <SelectContent>
            {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profile?.full_name || "Unnamed member"}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (actionType === "update_lead_stage" || actionType === "create_opportunity") {
    return (
      <div className="space-y-2">
        {actionType === "create_opportunity" && (
          <div>
            <Label className="text-xs">Opportunity title</Label>
            <Input value={(config.title as string) || ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. New deal" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Pipeline</Label>
            <Select value={pipelineId} onValueChange={(v) => onChange({ ...config, pipeline_id: v, pipeline_stage_id: "" })}>
              <SelectTrigger><SelectValue placeholder="Choose a pipeline" /></SelectTrigger>
              <SelectContent>
                {(pipelines || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Stage</Label>
            <Select value={(config.pipeline_stage_id as string) || ""} onValueChange={(v) => set("pipeline_stage_id", v)} disabled={!pipelineId}>
              <SelectTrigger><SelectValue placeholder="Choose a stage" /></SelectTrigger>
              <SelectContent>
                {(stages || []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    );
  }

  if (actionType === "create_internal_note") {
    return (
      <div>
        <Label className="text-xs">Note</Label>
        <Textarea value={(config.note as string) || ""} onChange={(e) => set("note", e.target.value)} placeholder="What should this note say?" rows={2} />
      </div>
    );
  }

  if (actionType === "create_notification") {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Title</Label>
          <Input value={(config.title as string) || ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Lead needs attention" />
        </div>
        <div>
          <Label className="text-xs">Body (optional)</Label>
          <Textarea value={(config.body as string) || ""} onChange={(e) => set("body", e.target.value)} rows={2} />
        </div>
        <div>
          <Label className="text-xs">Notify (defaults to you)</Label>
          <Select value={(config.user_id as string) || ""} onValueChange={(v) => set("user_id", v)}>
            <SelectTrigger><SelectValue placeholder="Choose a team member" /></SelectTrigger>
            <SelectContent>
              {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profile?.full_name || "Unnamed member"}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  // request_flow_ai_analysis
  return (
    <div>
      <Label className="text-xs">Prompt for Flow AI</Label>
      <Textarea value={(config.prompt as string) || ""} onChange={(e) => set("prompt", e.target.value)} placeholder="What should Flow AI analyze?" rows={2} />
    </div>
  );
}
