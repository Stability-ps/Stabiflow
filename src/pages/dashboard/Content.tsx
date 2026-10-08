import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

const CONTENT_TABS = [
  { label: "Media Library", path: "/app/content/media-library" },
  { label: "Calendar", path: "/app/content/calendar" },
  { label: "Scheduled", path: "/app/content/scheduled" },
  { label: "Published", path: "/app/content/published" },
  { label: "Drafts", path: "/app/content/drafts" },
];

export default function Content() {
  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-title-page text-foreground">Content</h1>
        <nav aria-label="Content sections" className="flex w-full max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 sm:w-fit">
          {CONTENT_TABS.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) =>
                cn(
                  "inline-flex min-h-9 shrink-0 items-center rounded-md px-3 text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
