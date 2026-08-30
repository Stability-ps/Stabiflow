import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { deleteCampaignDraft, duplicateCampaignDraft } from "@/lib/adCampaigns";
import { canDeleteCampaignDraft, isEditableCampaign } from "@/lib/campaignLifecycle";

type CampaignForActions = { id: string; name: string; status: string; external_campaign_id: string | null };

// Lifecycle-appropriate campaign management (spec 1). Only renders actions
// valid for the campaign's current state; nothing mutates until the user
// explicitly confirms. Delete is draft-only (also RLS-enforced), visually
// de-emphasised, and gated behind a name-identified confirmation dialog -
// it never removes anything from Meta.
export function CampaignActionsMenu({ campaign }: { campaign: CampaignForActions }) {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const editable = isEditableCampaign(campaign);
  const canEdit = editable && hasPermission("campaign.edit");
  const canDuplicate = hasPermission("campaign.create");
  const canDelete = canDeleteCampaignDraft(campaign) && hasPermission("campaign.delete");

  if (!canEdit && !canDuplicate && !canDelete) return null;

  const handleDuplicate = async () => {
    setDuplicating(true);
    try {
      const { campaignId } = await duplicateCampaignDraft(campaign.id);
      await queryClient.invalidateQueries({ queryKey: ["ad-campaigns"] });
      toast.success(`Duplicated as "${campaign.name} - Copy"`);
      navigate(`/app/campaigns/${campaignId}/edit`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to duplicate this campaign");
    } finally {
      setDuplicating(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteCampaignDraft(campaign.id);
      await queryClient.invalidateQueries({ queryKey: ["ad-campaigns"] });
      toast.success(`Deleted draft "${campaign.name}"`);
      navigate("/app/campaigns");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete this draft");
    } finally {
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && (
        <Button variant="outline" onClick={() => navigate(`/app/campaigns/${campaign.id}/edit`)}>
          <Pencil className="mr-2 h-4 w-4" /> Edit campaign
        </Button>
      )}
      {canDuplicate && (
        <Button variant="outline" onClick={handleDuplicate} disabled={duplicating}>
          <Copy className="mr-2 h-4 w-4" /> {duplicating ? "Duplicating..." : "Duplicate campaign"}
        </Button>
      )}
      {canDelete && (
        <Button
          variant="ghost"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirmDeleteOpen(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete draft
        </Button>
      )}

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft &ldquo;{campaign.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the StabiFlow draft <strong>{campaign.name}</strong>. It has not been
              published to Meta, so nothing is removed from your ad account. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
