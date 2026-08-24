import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

const CONTENT_TABS = [
  { label: "Calendar", path: "/content/calendar" },
  { label: "Scheduled", path: "/content/scheduled" },
  { label: "Published", path: "/content/published" },
  { label: "Drafts", path: "/content/drafts" },
  { label: "Media Library", path: "/content/media-library" },
];

export default function Content() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Content</h1>
        <p className="text-muted-foreground">Calendar, scheduled posts, drafts, and your Media Library.</p>
      </div>
      <nav className="flex gap-1 border-b">
        {CONTENT_TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              cn(
                "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
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
