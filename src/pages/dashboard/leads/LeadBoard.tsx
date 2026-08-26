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
  const boardLeads = leads.filter((l) => l.pipeline_id === selectedPipelineId && l.status === "active");

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
      <div className="border-b p-3">
        <Select value={selectedPipelineId || ""} onValueChange={onSelectPipeline}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Select a pipeline" /></SelectTrigger>
          <SelectContent>
            {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.is_default ? " (default)" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-1 gap-3 overflow-x-auto p-3">
        {activeStages.map((stage) => (
          <div
            key={stage.id}
            onDragOver={(e) => { e.preventDefault(); setDragOverStageId(stage.id); }}
            onDragLeave={() => setDragOverStageId((v) => (v === stage.id ? null : v))}
            onDrop={() => handleDrop(stage.id)}
            className={`flex w-64 shrink-0 flex-col rounded-md border bg-muted/20 ${dragOverStageId === stage.id ? "ring-2 ring-primary" : ""}`}
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
                  <p className="font-medium">{lead.contact_name || lead.phone || lead.human_reference}</p>
                  <p className="text-muted-foreground">{lead.human_reference}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
