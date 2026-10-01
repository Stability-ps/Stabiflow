import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { isNavItemActive, type NavItem } from "@/lib/navigation";

const PRIMARY_LABELS = ["Home", "Business", "Messages", "Marketing"];

/** App-style bottom tab bar for phones (< 768px, matching useIsMobile's
 * breakpoint) - the four most-used sections, plus "More" for the rest, so
 * mobile never has to cram all seven destinations into one bar. Desktop
 * keeps the sidebar; this renders nothing at md and up. */
export function MobileBottomNav({ items }: { items: NavItem[] }) {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = PRIMARY_LABELS.map((label) => items.find((i) => i.label === label)).filter((i): i is NavItem => !!i);
  const rest = items.filter((i) => !PRIMARY_LABELS.includes(i.label));
  const moreActive = rest.some((i) => isNavItemActive(i, pathname));

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 grid border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
        style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {primary.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
        {rest.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="More"
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium",
              moreActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        )}
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="md:hidden">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="mt-2 grid gap-1 pb-[env(safe-area-inset-bottom)]">
            {rest.map((item) => {
              const active = isNavItemActive(item, pathname);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg p-3 text-sm font-medium",
                    active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/60",
                  )}
                >
                  <item.icon className="h-4.5 w-4.5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
