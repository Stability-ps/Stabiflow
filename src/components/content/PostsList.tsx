import { useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CalendarX2, Copy, ExternalLink, Megaphone, MoreHorizontal, Send, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { MediaPreview } from "@/components/content/MediaPreview";
import { useAuth } from "@/hooks/useAuth";
import { useContentScheduledPosts, type ScheduledPostStatusFilter } from "@/hooks/useContentScheduledPosts";
import { supabase } from "@/integrations/supabase/client";
import { publishContentPostNow, scheduleContentPost } from "@/lib/contentFunctions";
import { formatInTimezone, parseLocalDateTimeInZone, toLocalDateTimeInputValue } from "@/lib/contentTimezone";
import { buildIdempotencyKey } from "@/lib/contentIdempotency";
import { postStatus } from "@/lib/contentPostStatus";

type PostRow = {
  id: string;
  target_platform: string;
  media_asset_id: string;
  facebook_page_id: string | null;
  instagram_account_id: string | null;
  scheduled_at: string;
  caption: string;
  status: string;
  failure_message: string | null;
  provider_permalink: string | null;
  content_media_assets: { title: string; storage_path: string } | null;
  workspace_facebook_pages: { page_name: string } | null;
  workspace_instagram_accounts: { username: string | null } | null;
};

export function PostsList({ statusFilter, workspaceTimezone, emptyTitle, emptyDescription }: {
  statusFilter: ScheduledPostStatusFilter;
  workspaceTimezone: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const { currentWorkspaceId, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const postsQuery = useContentScheduledPosts(currentWorkspaceId, statusFilter);
  const { data: posts, isLoading } = postsQuery;
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["content-scheduled-posts", currentWorkspaceId] });

  const handlePublishNow = async (postId: string) => {
    try {
      const result = await publishContentPostNow(postId);
      if (result.ok) toast.success("Published");
      else toast.warning(`Publish attempt: ${result.outcome.replace(/_/g, " ")}`);
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to publish");
    }
  };

  const handleRetry = async (postId: string) => {
    const { error } = await supabase
      .from("content_scheduled_posts")
      .update({ status: "scheduled", next_retry_at: null, failure_code: null, failure_message: null, claimed_at: null, claimed_by: null })
      .eq("id", postId);
    if (error) toast.error(error.message);
    else {
      toast.success("Queued for another attempt");
      await invalidate();
    }
  };

  const handleCancel = async (postId: string) => {
    const { error } = await supabase.from("content_scheduled_posts").update({ status: "cancelled" }).eq("id", postId);
    if (error) toast.error(error.message);
    else {
      toast.success("Post cancelled");
      await invalidate();
    }
  };

  const openReschedule = (post: PostRow) => {
    setReschedulingId(post.id);
    setRescheduleValue(toLocalDateTimeInputValue(new Date(post.scheduled_at), workspaceTimezone));
  };

  const submitReschedule = async (post: PostRow) => {
    const newAt = parseLocalDateTimeInZone(rescheduleValue, workspaceTimezone);
    if (!newAt || !currentWorkspaceId) return;
    const { data: fullPost } = await supabase.from("content_scheduled_posts").select("workspace_id, series_id, media_asset_id, target_platform, facebook_page_id, instagram_account_id").eq("id", post.id).single();
    if (!fullPost) return;
    const newKey = await buildIdempotencyKey({
      workspaceId: fullPost.workspace_id,
      seriesId: fullPost.series_id,
      mediaAssetId: fullPost.media_asset_id,
      targetPlatform: fullPost.target_platform,
      destinationId: fullPost.facebook_page_id || fullPost.instagram_account_id || "",
      scheduledAt: newAt,
    });
    const { error } = await supabase
      .from("content_scheduled_posts")
      .update({
        scheduled_at: newAt.toISOString(),
        idempotency_key: newKey,
        next_retry_at: null,
        // Rescheduling a failed/draft post re-queues it - it's explicitly
        // being given a new attempt, not left in its old terminal status.
        status: "scheduled",
        failure_code: null,
        failure_message: null,
      })
      .eq("id", post.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Post rescheduled");
      setReschedulingId(null);
      await invalidate();
    }
  };

  const handleDuplicate = async (post: PostRow) => {
    if (!currentWorkspaceId) return;
    try {
      await scheduleContentPost({
        workspace_id: currentWorkspaceId,
        target_platform: post.target_platform as "facebook" | "instagram",
        facebook_page_id: post.facebook_page_id ?? undefined,
        instagram_account_id: post.instagram_account_id ?? undefined,
        media_asset_id: post.media_asset_id,
        caption: post.caption,
        scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        status: "draft",
      });
      toast.success("Duplicated as a new draft");
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to duplicate");
    }
  };

  if (isLoading) {
    return <div className="space-y-2" role="status" aria-label="Loading posts">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)}</div>;
  }

  // A failed load is not "nothing here".
  if (postsQuery.isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load posts"
        description="Something went wrong fetching your posts. Nothing has been published or changed - try again."
        action={<Button variant="outline" onClick={() => void postsQuery.refetch()}>Try again</Button>}
        className="rounded-xl border border-border bg-card"
      />
    );
  }

  if (!posts?.length) {
    return <EmptyState icon={CalendarX2} title={emptyTitle} description={emptyDescription} className="rounded-xl border border-border bg-card" />;
  }

  const reschedulingPost = (posts as PostRow[]).find((p) => p.id === reschedulingId) ?? null;

  return (
    <div>
      <ul aria-label="Posts" className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {(posts as PostRow[]).map((post) => {
          const destination = post.workspace_facebook_pages?.page_name || (post.workspace_instagram_accounts?.username ? `@${post.workspace_instagram_accounts.username}` : "Unknown destination");
          const canAct = hasPermission("content.edit") || hasPermission("content.publish");
          const status = postStatus(post.status);
          const platform = post.target_platform.charAt(0).toUpperCase() + post.target_platform.slice(1);
          return (
            <li key={post.id} className="flex items-start gap-3 px-3 py-3 sm:px-4">
              {post.content_media_assets ? (
                <MediaPreview storagePath={post.content_media_assets.storage_path} alt={post.content_media_assets.title} className="h-14 w-14 shrink-0 rounded-lg object-cover" />
              ) : (
                <span aria-hidden="true" className="h-14 w-14 shrink-0 rounded-lg bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{platform} · {destination}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-foreground sm:truncate" title={post.caption}>{post.caption}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <time dateTime={post.scheduled_at}>{formatInTimezone(post.scheduled_at, workspaceTimezone)}</time>
                </p>
                {post.status === "failed" && post.failure_message && (
                  <p className="mt-1 text-xs text-destructive-strong">{post.failure_message}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {post.provider_permalink && (
                  <Button asChild variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground">
                    <a href={post.provider_permalink} target="_blank" rel="noreferrer" aria-label={`View on ${platform} (opens in a new tab)`}>
                      <ExternalLink aria-hidden="true" />
                    </a>
                  </Button>
                )}
                {canAct && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Post actions"><MoreHorizontal aria-hidden="true" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {post.status === "scheduled" && hasPermission("content.publish") && (
                        <DropdownMenuItem onClick={() => handlePublishNow(post.id)}><Send className="mr-2 h-4 w-4" /> Publish now</DropdownMenuItem>
                      )}
                      {post.status === "failed" && hasPermission("content.edit") && (
                        <DropdownMenuItem onClick={() => handleRetry(post.id)}><Send className="mr-2 h-4 w-4" /> Retry</DropdownMenuItem>
                      )}
                      {(post.status === "scheduled" || post.status === "draft" || post.status === "failed") && (
                        <DropdownMenuItem onClick={() => openReschedule(post)}><CalendarClock className="mr-2 h-4 w-4" /> Reschedule</DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleDuplicate(post)}><Copy className="mr-2 h-4 w-4" /> Duplicate</DropdownMenuItem>
                      {hasPermission("campaign.create") && (
                        <DropdownMenuItem
                          onClick={() =>
                            navigate("/app/campaigns/new", {
                              state: { prefill: { sourceContentMediaAssetId: post.media_asset_id, primaryText: post.caption } },
                            })
                          }
                        >
                          <Megaphone className="mr-2 h-4 w-4" /> Promote as Campaign
                        </DropdownMenuItem>
                      )}
                      {(post.status === "scheduled" || post.status === "draft" || post.status === "failed") && (
                        <DropdownMenuItem onClick={() => handleCancel(post.id)} className="text-destructive"><XCircle className="mr-2 h-4 w-4" /> Cancel</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog open={!!reschedulingId} onOpenChange={(open) => !open && setReschedulingId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Reschedule post</DialogTitle></DialogHeader>
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            New date and time
            <Input type="datetime-local" value={rescheduleValue} onChange={(e) => setRescheduleValue(e.target.value)} />
            <span className="text-xs font-normal text-muted-foreground">{workspaceTimezone}</span>
          </label>
          <DialogFooter>
            <Button className="w-full" onClick={() => reschedulingPost && submitReschedule(reschedulingPost)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
