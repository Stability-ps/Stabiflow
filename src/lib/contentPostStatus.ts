import type { StatusTone } from "@/components/ui/status-pill";

// One label + tone per content_scheduled_posts.status, shared by the posts
// lists and the calendar so they never disagree.
export const POST_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  scheduled: { label: "Scheduled", tone: "info" },
  publishing: { label: "Publishing", tone: "info" },
  published: { label: "Published", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  draft: { label: "Draft", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
};

export function postStatus(status: string): { label: string; tone: StatusTone } {
  return POST_STATUS[status] ?? { label: status.charAt(0).toUpperCase() + status.slice(1), tone: "neutral" };
}
