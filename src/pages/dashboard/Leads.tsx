import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Settings2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { usePipelines, useLeads } from "@/hooks/useLeads";
import { useOpportunityTerminology } from "@/hooks/useOpportunityTerminology";
import { LeadList, type LeadListFilter } from "@/pages/dashboard/leads/LeadList";
import { LeadBoard } from "@/pages/dashboard/leads/LeadBoard";
import { LeadDetail } from "@/pages/dashboard/leads/LeadDetail";
import { PipelineSettings } from "@/pages/dashboard/leads/PipelineSettings";
import { NewLeadDialog } from "@/pages/dashboard/leads/NewLeadDialog";

export default function Leads() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentWorkspaceId, currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canView = roleHasPermission(role, "lead.view");
  const canCreate = roleHasPermission(role, "lead.create");
  const canEdit = roleHasPermission(role, "lead.edit");
  const canAssign = roleHasPermission(role, "lead.assign");
  const canViewAttachments = roleHasPermission(role, "lead.attachment.view");
  const canManagePipelines = roleHasPermission(role, "pipeline.manage");
  const canCreateOpportunity = roleHasPermission(role, "opportunity.create");
  const canCloseOpportunity = roleHasPermission(role, "opportunity.close");
  const canRecordRevenue = roleHasPermission(role, "revenue.create");

  const { data: pipelines, isLoading: pipelinesLoading } = usePipelines(canView ? currentWorkspaceId : null);
  const { data: leads, isLoading: leadsLoading } = useLeads(canView ? currentWorkspaceId : null);
  const opportunityLabel = useOpportunityTerminology(currentWorkspaceId);

  const [view, setView] = useState<"board" | "list">("board");
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [pipelineSettingsOpen, setPipelineSettingsOpen] = useState(false);
  const [filter, setFilter] = useState<LeadListFilter>("all");
  const [search, setSearch] = useState("");
  const [autoOpenOpportunityForm, setAutoOpenOpportunityForm] = useState(false);

  useEffect(() => {
    const state = location.state as { selectedLeadId?: string; openOpportunityForm?: boolean } | null;
    if (!state?.selectedLeadId) return;
    setSelectedLeadId(state.selectedLeadId);
    setAutoOpenOpportunityForm(!!state.openOpportunityForm);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  // Every workspace's default pipeline is now created atomically by
  // create_workspace() itself (see 20260906060000_default_pipeline_lifecycle_fix.sql)
  // - a workspace reaching this page with zero pipelines should no longer
  // happen. No frontend call creates one; correctness never depends on
  // visiting this page. (The server-side ensure_default_pipeline action
  // still exists as a defensive/recovery mechanism - see pipelines-actions.)
  useEffect(() => {
    if (!selectedPipelineId && pipelines?.length) {
      setSelectedPipelineId(pipelines.find((p) => p.is_default)?.id || pipelines[0].id);
    }
  }, [pipelines, selectedPipelineId]);

  if (!currentWorkspaceId || pipelinesLoading || leadsLoading) {
    return <div className="h-[70vh] animate-pulse rounded-lg bg-muted" />;
  }

  if (!canView) {
    return <EmptyState icon={Users} title="Leads" description="You don't have permission to view this workspace's leads. Ask a workspace owner or admin." />;
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">Leads, qualification, and your configurable pipeline stages.</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as "board" | "list")}>
            <TabsList>
              <TabsTrigger value="board">Board</TabsTrigger>
              <TabsTrigger value="list">List</TabsTrigger>
            </TabsList>
          </Tabs>
          {canManagePipelines && (
            <Button size="sm" variant="outline" onClick={() => setPipelineSettingsOpen(true)}><Settings2 className="mr-1.5 h-3.5 w-3.5" /> Pipelines</Button>
          )}
          {canCreate && <NewLeadDialog workspaceId={currentWorkspaceId} onCreated={setSelectedLeadId} />}
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-lg border">
        {view === "board" ? (
          <LeadBoard
            workspaceId={currentWorkspaceId}
            leads={leads || []}
            pipelines={pipelines || []}
            selectedPipelineId={selectedPipelineId}
            onSelectPipeline={setSelectedPipelineId}
            onSelectLead={setSelectedLeadId}
            canEdit={canEdit}
          />
        ) : (
          <LeadList leads={leads || []} onSelect={setSelectedLeadId} filter={filter} onFilterChange={setFilter} search={search} onSearchChange={setSearch} />
        )}
      </div>

      <Sheet open={!!selectedLeadId} onOpenChange={(v) => { if (!v) { setSelectedLeadId(null); setAutoOpenOpportunityForm(false); } }}>
        {selectedLeadId && (
          <LeadDetail
            key={selectedLeadId}
            workspaceId={currentWorkspaceId}
            leadId={selectedLeadId}
            canEdit={canEdit}
            canAssign={canAssign}
            canViewAttachments={canViewAttachments}
            canCreateOpportunity={canCreateOpportunity}
            canCloseOpportunity={canCloseOpportunity}
            canRecordRevenue={canRecordRevenue}
            opportunityLabel={opportunityLabel}
            autoOpenOpportunityForm={autoOpenOpportunityForm}
          />
        )}
      </Sheet>

      <Sheet open={pipelineSettingsOpen} onOpenChange={setPipelineSettingsOpen}>
        {pipelineSettingsOpen && <PipelineSettings workspaceId={currentWorkspaceId} />}
      </Sheet>
    </div>
  );
}
