import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

// Desktop only: on phones the app header already shows a back button.
export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="hidden min-h-9 items-center gap-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {children}
    </Link>
  );
}
