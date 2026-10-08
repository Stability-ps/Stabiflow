import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, Mail, MoreHorizontal, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceMembers, useWorkspacePendingInvitations } from "@/hooks/useWorkspaceMembers";
import { fetchEntitlements } from "@/lib/billing";
import { changeMemberRole, inviteMember, removeMember, revokeInvitation } from "@/lib/workspaceMembers";
import { ROLE_LABELS, WORKSPACE_ROLES, canGrantRole, canManageMemberWithRole, type WorkspaceRole } from "@/lib/workspaceRoles";

function buildInvitationLink(token: string) {
  return `${window.location.origin}/accept-invitation?token=${token}`;
}

type InvitationConfirmation = { email: string; role: WorkspaceRole; expiresAt: string; link: string };

export function MembersTab() {
  const { currentWorkspaceId, currentMembership, user } = useAuth();
  const queryClient = useQueryClient();
  const { data: members, isLoading: membersLoading, isError: membersError, refetch: refetchMembers } = useWorkspaceMembers(currentWorkspaceId);
  const { data: invitations, isLoading: invitesLoading, isError: invitesError, refetch: refetchInvites } = useWorkspacePendingInvitations(currentWorkspaceId);
  const entitlements = useQuery({
    queryKey: ["entitlements", currentWorkspaceId],
    queryFn: () => fetchEntitlements(currentWorkspaceId as string),
    enabled: !!currentWorkspaceId,
  });
  const callerRole = currentMembership?.role;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("viewer");
  const [inviting, setInviting] = useState(false);
  const [invitationConfirmation, setInvitationConfirmation] = useState<InvitationConfirmation | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; label: string } | null>(null);
  const [renderedAt] = useState(() => Date.now());

  const grantableRoles = WORKSPACE_ROLES.filter((r) => canGrantRole(callerRole, r));
  const seatEntitlement = entitlements.data?.find((e) => e.entitlement_key === "team_seats");
  const seatLimit = seatEntitlement?.unlimited ? null : seatEntitlement?.limit_value ?? null;
  const seatsUsed = members?.length ?? 0;
  const pendingSeats = (invitations ?? []).filter((inv) => new Date(inv.expires_at).getTime() > Date.now()).length;
  const seatsCommitted = seatsUsed + pendingSeats;
  const seatAvailable = seatEntitlement?.enabled === true && (seatLimit === null || seatsCommitted < seatLimit);
  const canInvite = grantableRoles.length > 0;
  const canCreateInvite = canInvite && seatAvailable;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace-members", currentWorkspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-invitations", currentWorkspaceId] }),
    ]);

  const handleInvite = async () => {
    if (!currentWorkspaceId || !user || !inviteEmail.trim()) return;
    setInviting(true);
    try {
      const normalizedEmail = inviteEmail.trim().toLowerCase();
      const created = await inviteMember(currentWorkspaceId, normalizedEmail, inviteRole, user.id);
      await invalidate();
      setInvitationConfirmation({ email: normalizedEmail, role: inviteRole, expiresAt: created.expiresAt, link: buildInvitationLink(created.token) });
      setInviteEmail("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create invitation");
    } finally {
      setInviting(false);
    }
  };

  const copyInvitationLink = async (link: string) => {
    await navigator.clipboard.writeText(link);
    setCopiedLink(link);
    toast.success("Invitation link copied");
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeInvitation(id);
      await invalidate();
      toast.success("Invitation revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to revoke invitation");
    }
  };

  const handleRoleChange = async (memberRowId: string, newRole: WorkspaceRole) => {
    try {
      await changeMemberRole(memberRowId, newRole);
      await invalidate();
      toast.success("Role updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to change role");
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      await removeMember(removeTarget.id);
      await invalidate();
      toast.success(`${removeTarget.label} removed from this workspace`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove this member");
    } finally {
      setRemoveTarget(null);
    }
  };

  if (membersLoading || invitesLoading || entitlements.isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  // A failed read must not render as "no members / no invitations" - and
  // seat counts computed from an empty list would be wrong too.
  if (membersError || invitesError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load members"
        description="Something went wrong fetching this workspace's members and invitations. Nothing has changed - try again."
        action={<Button variant="outline" onClick={() => { void refetchMembers(); void refetchInvites(); }}>Try again</Button>}
        className="rounded-xl border border-border bg-card"
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="min-w-[12rem] flex-1">
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Everyone with access to this workspace.
              {seatEntitlement?.enabled && (
                <span className="ml-1">
                  {seatLimit === null ? `${seatsUsed} members · unlimited seats` : `${seatsCommitted} of ${seatLimit} seats committed`}
                </span>
              )}
            </CardDescription>
          </div>
          {canInvite && (
            <Dialog open={inviteOpen} onOpenChange={(open) => { setInviteOpen(open); if (!open) { setInvitationConfirmation(null); setCopiedLink(null); } }}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={!canCreateInvite} title={!seatAvailable ? "Your current plan has no available team seats" : undefined}>
                  <UserPlus aria-hidden="true" /> Invite member
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>Invite a member</DialogTitle></DialogHeader>
                {invitationConfirmation ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      StabiFlow doesn't send invitation emails yet - copy this link and share it with them directly (WhatsApp, email, etc.).
                    </p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-muted/60 p-3 text-sm">
                      <dt className="text-muted-foreground">Invite created for</dt><dd className="min-w-0 truncate font-medium" title={invitationConfirmation.email}>{invitationConfirmation.email}</dd>
                      <dt className="text-muted-foreground">Role</dt><dd className="font-medium">{ROLE_LABELS[invitationConfirmation.role]}</dd>
                      <dt className="text-muted-foreground">Expires</dt><dd className="font-medium">{new Date(invitationConfirmation.expiresAt).toLocaleString()}</dd>
                    </dl>
                    <Label htmlFor="created-invitation-link">Invitation link</Label>
                    <div className="flex gap-2">
                      <Input id="created-invitation-link" readOnly value={invitationConfirmation.link} className="min-w-0 truncate text-xs" title={invitationConfirmation.link} />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void copyInvitationLink(invitationConfirmation.link)}
                      >
                        <Copy className="mr-2 h-4 w-4" /> {copiedLink === invitationConfirmation.link ? "Copied" : "Copy link"}
                      </Button>
                    </div>
                    <Button className="w-full" variant="outline" onClick={() => { setInvitationConfirmation(null); setCopiedLink(null); }}>Invite someone else</Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="invite-email">Email</Label>
                      <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@company.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="invite-role">Role</Label>
                      <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as WorkspaceRole)}>
                        <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {grantableRoles.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <DialogFooter>
                      <Button className="w-full" disabled={!inviteEmail.trim() || inviting || !seatAvailable} onClick={handleInvite}>
                        {inviting ? "Creating..." : "Create invitation"}
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {(members || []).map((m) => {
            const canManage = canManageMemberWithRole(callerRole, m.role);
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border p-3">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="text-xs">{(m.profile?.full_name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-[8rem] flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{m.profile?.full_name || "Unnamed"}{m.user_id === user?.id ? " (you)" : ""}</p>
                  <p className="text-xs text-muted-foreground">Joined {new Date(m.joined_at).toLocaleDateString()}</p>
                </div>
                {/* Role + actions wrap under the name on narrow phones rather than squeezing it to nothing. */}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                {canManage ? (
                  <Select value={m.role} onValueChange={(v) => handleRoleChange(m.id, v as WorkspaceRole)}>
                    <SelectTrigger className="w-32" aria-label={`Role for ${m.profile?.full_name || "this member"}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WORKSPACE_ROLES.filter((r) => canGrantRole(callerRole, r)).map((r) => (
                        <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="secondary">{ROLE_LABELS[m.role]}</Badge>
                )}
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Actions for ${m.profile?.full_name || "this member"}`}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setRemoveTarget({ id: m.id, label: m.profile?.full_name || "This member" })}
                      >
                        <UserMinus className="mr-2 h-4 w-4" /> Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {canInvite && (
      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>Invitations that haven't been accepted yet.</CardDescription>
        </CardHeader>
        <CardContent>
          {!invitations?.length ? (
            <EmptyState icon={Mail} title="No pending invitations" description="Invite a teammate above to get started." />
          ) : (
            <div className="space-y-2">
              {invitations.map((inv) => (
                <div key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border p-3">
                  <div className="min-w-[10rem] flex-1">
                    <p className="truncate text-sm font-medium text-foreground" title={inv.email}>{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {ROLE_LABELS[inv.role]} · expires {new Date(inv.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
                  <Badge variant={new Date(inv.expires_at).getTime() <= renderedAt ? "destructive" : "secondary"}>
                    {new Date(inv.expires_at).getTime() <= renderedAt ? "Expired" : "Pending"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={new Date(inv.expires_at).getTime() <= renderedAt}
                    onClick={() => void copyInvitationLink(buildInvitationLink(inv.token))}
                  >
                    <Copy aria-hidden="true" /> {copiedLink === buildInvitationLink(inv.token) ? "Copied" : "Copy link"}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleRevoke(inv.id)}>Revoke</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.label}?</AlertDialogTitle>
            <AlertDialogDescription>They will immediately lose access to this workspace. This can't be undone from here.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
