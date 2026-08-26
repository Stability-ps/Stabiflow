import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePipelines, usePipelineStages } from "@/hooks/useLeads";
import {
  addPipelineStage, createPipeline, renamePipeline, renamePipelineStage,
  reorderPipelineStages, setDefaultPipeline, setPipelineStageActive, setPipelineStageFlags,
} from "@/lib/leads";
import { computeReorderedStages } from "@/lib/pipelineOrdering";

export function PipelineSettings({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const { data: pipelines } = usePipelines(workspaceId);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const activePipelineId = selectedPipelineId || pipelines?.[0]?.id || null;
  const { data: stages } = usePipelineStages(workspaceId, activePipelineId);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [newStageName, setNewStageName] = useState("");
  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pipelines", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["pipeline-stages", workspaceId, activePipelineId] });
  };

  const sortedStages = (stages || []).slice().sort((a, b) => a.sort_order - b.sort_order);

  const handleCreatePipeline = async () => {
    if (!newPipelineName.trim()) return;
    setBusy(true);
    try {
      await createPipeline(workspaceId, newPipelineName.trim());
      setNewPipelineName("");
      invalidate();
      toast.success("Pipeline created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create this pipeline");
    } finally {
      setBusy(false);
    }
  };

  const handleSetDefault = async () => {
    if (!activePipelineId) return;
    setBusy(true);
    try {
      await setDefaultPipeline(workspaceId, activePipelineId);
      invalidate();
      toast.success("Default pipeline updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to set the default pipeline");
    } finally {
      setBusy(false);
    }
  };

  const handleAddStage = async () => {
    if (!activePipelineId || !newStageName.trim()) return;
    setBusy(true);
    try {
      await addPipelineStage(workspaceId, activePipelineId, newStageName.trim());
      setNewStageName("");
      invalidate();
      toast.success("Stage added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add this stage");
    } finally {
      setBusy(false);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sortedStages.length || !activePipelineId) return;
    const ids = sortedStages.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true);
    try {
      const reordered = computeReorderedStages(sortedStages.map((s) => s.id), ids);
      await reorderPipelineStages(workspaceId, activePipelineId, reordered.map((r) => r.id));
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reorder stages");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader className="text-left">
        <SheetTitle>Pipeline settings</SheetTitle>
        <SheetDescription>Configure this workspace's sales/service process.</SheetDescription>
      </SheetHeader>

      <div className="mt-4 space-y-4">
        <div className="flex gap-2">
          <Select value={activePipelineId || ""} onValueChange={setSelectedPipelineId}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Select a pipeline" /></SelectTrigger>
            <SelectContent>
              {(pipelines || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.is_default ? " (default)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          {activePipelineId && !pipelines?.find((p) => p.id === activePipelineId)?.is_default && (
            <Button size="sm" variant="outline" onClick={handleSetDefault} disabled={busy}><Star className="mr-1.5 h-3.5 w-3.5" /> Set default</Button>
          )}
        </div>

        {activePipelineId && (
          <Input
            key={activePipelineId}
            defaultValue={pipelines?.find((p) => p.id === activePipelineId)?.name || ""}
            className="h-8 text-xs"
            placeholder="Pipeline name"
            onBlur={(e) => {
              const name = e.target.value.trim();
              const current = pipelines?.find((p) => p.id === activePipelineId)?.name;
              if (name && name !== current) renamePipeline(workspaceId, activePipelineId, name).then(invalidate).catch(() => toast.error("Unable to rename this pipeline"));
            }}
          />
        )}

        <div className="flex gap-2">
          <Input placeholder="New pipeline name" value={newPipelineName} onChange={(e) => setNewPipelineName(e.target.value)} className="h-8 text-xs" />
          <Button size="sm" onClick={handleCreatePipeline} disabled={busy || !newPipelineName.trim()}>Create pipeline</Button>
        </div>

        {activePipelineId && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-medium text-muted-foreground">Stages</p>
            {sortedStages.map((stage, index) => (
              <div key={stage.id} className="flex items-center gap-2 rounded-md border p-2 text-xs">
                <div className="flex flex-col">
                  <button onClick={() => handleMove(index, -1)} disabled={busy || index === 0} className="disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                  <button onClick={() => handleMove(index, 1)} disabled={busy || index === sortedStages.length - 1} className="disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                </div>
                <Input
                  defaultValue={stage.name}
                  className="h-7 flex-1 text-xs"
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value.trim() !== stage.name) {
                      renamePipelineStage(workspaceId, stage.id, e.target.value.trim()).then(invalidate).catch(() => toast.error("Unable to rename this stage"));
                    }
                  }}
                />
                {!stage.is_active && <Badge variant="secondary">Inactive</Badge>}
                {stage.is_won_stage && <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Won</Badge>}
                <Button
                  size="sm" variant="ghost" className="h-7 px-2"
                  onClick={() => setPipelineStageFlags(workspaceId, stage.id, { isWonStage: !stage.is_won_stage }).then(invalidate)}
                >
                  {stage.is_won_stage ? "Unset won" : "Mark won"}
                </Button>
                <Button
                  size="sm" variant="ghost" className="h-7 px-2"
                  onClick={() => setPipelineStageActive(workspaceId, stage.id, !stage.is_active).then(invalidate)}
                >
                  {stage.is_active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input placeholder="New stage name" value={newStageName} onChange={(e) => setNewStageName(e.target.value)} className="h-8 text-xs" />
              <Button size="sm" variant="outline" onClick={handleAddStage} disabled={busy || !newStageName.trim()}>Add stage</Button>
            </div>
          </div>
        )}
      </div>
    </SheetContent>
  );
}
