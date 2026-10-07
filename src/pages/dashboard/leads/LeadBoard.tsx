import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { StatusPill } from "@/components/ui/status-pill";
import { FollowUpPill } from "@/pages/dashboard/leads/LeadPills";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { LayoutGrid } from "lucide-react";
import { usePipelineStages, type LeadRow, type Pipeline } from "@/hooks/useLeads";
import { moveLeadStage } from "@/lib/leads";

export function LeadBoard({ workspaceId, leads, pipelines, selectedPipelineId, onSelectPipeline, onSelectLead, canEdit, ownerName, now }: {
  workspaceId: string;
  leads: LeadRow[];
  pipelines: Pipeline[];
  selectedPipelineId: string | null;
  onSelectPipeline: (id: string) => void;
  onSelectLead: (id: string) => void;
  canEdit: boolean;
  ownerName: (userId: string | null) => string | null;
  now: Date;
}) {
  const queryClient = useQueryClient();
  const { data: stages } = usePipelineStages(workspaceId, selectedPipelineId);
  const [dragLeadId, setDragLeadId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  const activeStages = (stages || []).filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order);
  const boardLeads = leads.filter((l) => l.pipeline_id === selectedPipelineId && l.status === "active" && !l.archived_at);
  const totalValue = boardLeads.reduce((sum, lead) => sum + (Number(lead.estimated_value) || 0), 0);
  const overdueCount = boardLeads.filter((lead) => lead.next_follow_up_at && new Date(lead.next_follow_up_at).getTime() < now.getTime()).length;

  const handleDrop = async (stageId: string) => {
    const leadId = dragLeadId;
    setDragLeadId(null);
    setDragOverStageId(null);
    if (!leadId || !selectedPipelineId || !canEdit) return;
    const lead = boardLeads.find((l) => l.id === leadId);
    if (!lead || lead.pipeline_stage_id === stageId) return;

    queryClient.setQueryData<LeadRow[]>(["leads", workspaceId], (prev) => prev?.map((l) => (l.id === leadId ? { ...l, pipeline_stage_id: stageId } : l)));
    try {
      await moveLeadStage(workspaceId, leadId, selectedPipelineId, stageId);
    } catch (error) {
      queryClient.invalidateQueries({ queryKey: ["leads", workspaceId] });
      toast.error(error instanceof Error ? error.message : "Unable to move this lead");
    }
  };

  if (pipelines.length === 0) {
    return <EmptyState icon={LayoutGrid} title="No pipeline configured" description="Create a pipeline to start tracking opportunities." className="h-full" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <Select value={selectedPipelineId || ""} onValueChange={onSelectPipeline}>
          <SelectTrigger className="w-56" aria-label="Pipeline"><SelectValue placeholder="Select a pipeline" /></SelectTrigger>
          <SelectContent>
            {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.is_default ? " (default)" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span><strong className="font-semibold text-foreground">{boardLeads.length}</strong> open</span>
          <span aria-hidden="true">·</span>
          <span><strong className="font-semibold text-foreground">{boardLeads.filter((lead) => lead.qualification_status === "qualified").length}</strong> qualified</span>
          {overdueCount > 0 && <><span aria-hidden="true">·</span><StatusPill tone="danger">{overdueCount} overdue</StatusPill></>}
          {totalValue > 0 && <><span aria-hidden="true">·</span><span><strong className="font-semibold text-foreground">R{totalValue.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}</strong> pipeline value</span></>}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3" role="list" aria-label="Pipeline stages">
        {activeStages.map((stage) => {
          const stageLeads = boardLeads.filter((l) => l.pipeline_stage_id === stage.id);
          return (
            <section
              key={stage.id}
              role="listitem"
              aria-label={`${stage.name}, ${stageLeads.length} leads`}
              onDragOver={(e) => { e.preventDefault(); setDragOverStageId(stage.id); }}
              onDragLeave={() => setDragOverStageId((v) => (v === stage.id ? null : v))}
              onDrop={() => handleDrop(stage.id)}
              className={`flex min-w-[15rem] max-w-[20rem] flex-1 basis-60 flex-col rounded-xl bg-muted/60 ${dragOverStageId === stage.id ? "ring-2 ring-ring" : ""}`}
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <h3 className="truncate text-title-card text-foreground">{stage.name}</h3>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">{stageLeads.length}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {stageLeads.length === 0 && <p className="px-1 py-3 text-center text-xs text-muted-foreground">No leads in this stage</p>}
                {stageLeads.map((lead) => {
                  const owner = ownerName(lead.assigned_to);
                  return (
                    <button
                      type="button"
                      key={lead.id}
                      draggable={canEdit}
                      onDragStart={() => setDragLeadId(lead.id)}
                      onDragEnd={() => setDragLeadId(null)}
                      onClick={() => onSelectLead(lead.id)}
                      className="block w-full cursor-pointer rounded-lg border border-border bg-card p-2.5 text-left text-xs shadow-xs transition-colors duration-fast hover:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">{lead.contact_name || lead.phone || lead.human_reference}</span>
                        {lead.estimated_value != null && Number(lead.estimated_value) > 0 && <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">R{Number(lead.estimated_value).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-muted-foreground">{[lead.company_name, lead.source].filter(Boolean).join(" · ")}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-1">
                        {lead.qualification_status === "qualified" && <StatusPill tone="success" dot={false}>Qualified</StatusPill>}
                        {lead.next_follow_up_at && <FollowUpPill lead={lead} now={now} />}
                        <span className={`ml-auto ${owner ? "text-muted-foreground" : "font-medium text-warning"}`}>{owner ?? "Unassigned"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
