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
    <div className="operational-page space-y-4">
      <div className="operational-header">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Content workspace</p>
        <h1 className="operational-title">Content</h1>
        <p className="text-muted-foreground">Calendar, scheduled posts, drafts, and your Media Library.</p>
      </div>
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-border/70 bg-card/80 p-1 shadow-sm">
        {CONTENT_TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              cn(
                "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
