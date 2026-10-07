import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { LayoutGrid } from "lucide-react";
import { usePipelineStages, type LeadRow, type Pipeline } from "@/hooks/useLeads";
import { moveLeadStage } from "@/lib/leads";

export function LeadBoard({ workspaceId, leads, pipelines, selectedPipelineId, onSelectPipeline, onSelectLead, canEdit }: {
  workspaceId: string;
  leads: LeadRow[];
  pipelines: Pipeline[];
  selectedPipelineId: string | null;
  onSelectPipeline: (id: string) => void;
  onSelectLead: (id: string) => void;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: stages } = usePipelineStages(workspaceId, selectedPipelineId);
  const [dragLeadId, setDragLeadId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  const activeStages = (stages || []).filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order);
  const boardLeads = leads.filter((l) => l.pipeline_id === selectedPipelineId && l.status === "active" && !l.archived_at);
  const totalValue = boardLeads.reduce((sum, lead) => sum + (Number(lead.estimated_value) || 0), 0);
  const overdueCount = boardLeads.filter((lead) => lead.next_follow_up_at && new Date(lead.next_follow_up_at).getTime() < Date.now()).length;

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
    return <EmptyState icon={LayoutGrid} title="No pipeline configured" description="Create a pipeline to start tracking opportunities." className="h-full border-none" />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <Select value={selectedPipelineId || ""} onValueChange={onSelectPipeline}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Select a pipeline" /></SelectTrigger>
          <SelectContent>
            {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.is_default ? " (default)" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-muted px-2.5 py-1"><strong>{boardLeads.length}</strong> open</span>
          <span className="rounded-full bg-muted px-2.5 py-1"><strong>{boardLeads.filter((lead) => lead.qualification_status === "qualified").length}</strong> qualified</span>
          {overdueCount > 0 && <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-destructive"><strong>{overdueCount}</strong> overdue</span>}
          {totalValue > 0 && <span className="rounded-full bg-muted px-2.5 py-1"><strong>R{totalValue.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}</strong> pipeline value</span>}
        </div>
      </div>
      <div className="flex flex-1 gap-3 overflow-x-auto p-3">
        {activeStages.map((stage) => (
          <div
            key={stage.id}
            onDragOver={(e) => { e.preventDefault(); setDragOverStageId(stage.id); }}
            onDragLeave={() => setDragOverStageId((v) => (v === stage.id ? null : v))}
            onDrop={() => handleDrop(stage.id)}
            className={`flex min-w-[240px] flex-1 basis-60 flex-col rounded-md border bg-muted/20 ${dragOverStageId === stage.id ? "ring-2 ring-primary" : ""}`}
          >
            <div className="flex items-center justify-between border-b p-2">
              <p className="text-sm font-medium">{stage.name}</p>
              <Badge variant="secondary">{boardLeads.filter((l) => l.pipeline_stage_id === stage.id).length}</Badge>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {boardLeads.filter((l) => l.pipeline_stage_id === stage.id).map((lead) => (
                <div
                  key={lead.id}
                  draggable={canEdit}
                  onDragStart={() => setDragLeadId(lead.id)}
                  onDragEnd={() => setDragLeadId(null)}
                  onClick={() => onSelectLead(lead.id)}
                  className="cursor-pointer rounded-md border bg-background p-2 text-xs shadow-sm hover:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{lead.contact_name || lead.phone || lead.human_reference}</p>
                    {lead.estimated_value != null && Number(lead.estimated_value) > 0 && <span className="shrink-0 font-medium">R{Number(lead.estimated_value).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}</span>}
                  </div>
                  {lead.company_name && <p className="mt-0.5 truncate text-muted-foreground">{lead.company_name}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Badge variant="outline" className="text-[10px]">{lead.source || "manual"}</Badge>
                    {lead.qualification_status === "qualified" && <Badge variant="secondary" className="text-[10px]">Qualified</Badge>}
                    {lead.next_follow_up_at && <Badge variant="outline" className={`text-[10px] ${new Date(lead.next_follow_up_at).getTime() < Date.now() ? "border-destructive/40 text-destructive" : ""}`}>{new Date(lead.next_follow_up_at).getTime() < Date.now() ? "Follow-up overdue" : `Follow up ${new Date(lead.next_follow_up_at).toLocaleDateString()}`}</Badge>}
                    <span className="ml-auto text-[10px] text-muted-foreground">{lead.human_reference}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
