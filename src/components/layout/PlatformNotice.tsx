import { Info } from "lucide-react";
import { readText, usePublicSettings } from "@/hooks/usePublicSettings";

/** Platform-wide notice set by an administrator (Admin -> Settings & content -> platform.notice). */
export function PlatformNotice() {
  const { data } = usePublicSettings();
  const notice = data?.["platform.notice"] as { enabled?: boolean; tone?: string } | undefined;
  const message = readText(notice, "message", 400);
  if (!notice?.enabled || !message) return null;
  const warn = notice.tone === "warning";
  return (
    <div role="status" className={`flex items-center gap-2 border-b px-4 py-2 text-sm ${warn ? "bg-amber-50 text-amber-900" : "bg-sky-50 text-sky-900"}`}>
      <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
