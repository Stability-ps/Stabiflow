import { Link } from "react-router-dom";
import { CircleHelp } from "lucide-react";
import { chapterPath } from "@/content/guide/paths";
import { cn } from "@/lib/utils";

/** Small, quiet link from a product page to the guide article that explains it. */
export function GuideHelpLink({ chapter, section, label = "Learn how this works", className }: { chapter: string; section?: string; label?: string; className?: string }) {
  return (
    <Link
      to={chapterPath(chapter, section)}
      className={cn("inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Link>
  );
}
