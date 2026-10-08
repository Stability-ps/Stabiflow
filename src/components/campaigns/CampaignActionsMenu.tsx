import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { deleteCampaignDraft, duplicateCampaignDraft } from "@/lib/adCampaigns";
import { canDeleteCampaignDraft, isEditableCampaign } from "@/lib/campaignLifecycle";

type CampaignForActions = { id: string; name: string; status: string; external_campaign_id: string | null };

// Lifecycle-appropriate campaign management (spec 1 / 8). Edit is the
// primary action; Duplicate and Delete draft live in a "..." overflow
// menu. Only actions valid for the current lifecycle state render, and
// nothing mutates until the user explicitly confirms - opening the menu
// does nothing. Delete is draft-only (also RLS-enforced), destructive,
// and gated by a name-identified confirmation; it never touches Meta.
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
    <div className="flex items-center gap-2">
      {canEdit && (
        <Button variant="outline" onClick={() => navigate(`/app/campaigns/${campaign.id}/edit`)}>
          <Pencil className="mr-2 h-4 w-4" /> Edit campaign
        </Button>
      )}
      {(canDuplicate || canDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More campaign actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canDuplicate && (
              <DropdownMenuItem onClick={handleDuplicate} disabled={duplicating}>
                <Copy className="mr-2 h-4 w-4" /> {duplicating ? "Duplicating..." : "Duplicate campaign"}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                {canDuplicate && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete draft
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
