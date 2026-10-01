import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { isMobileNavItemActive, mobileNavModel, NAV_ITEMS, type NavItem } from "@/lib/navigation";
import { MobileMoreSheet } from "@/components/layout/MobileMoreSheet";

const TAB =
  "relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 pt-1.5 pb-1 text-[11px] font-medium leading-tight tracking-tight " +
  "text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

/**
 * Phone-only primary navigation (hidden from md up, where the desktop
 * sidebar takes over). `items` is the same feature-flag filtered list
 * AppLayout passes to the sidebar.
 */
export function MobileBottomNav({ items = NAV_ITEMS }: { items?: NavItem[] }) {
  const { pathname } = useLocation();
  const { primary, more } = mobileNavModel(items);
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryActive = primary.some((i) => isMobileNavItemActive(i, pathname));
  const moreActive = !primaryActive && more.some((i) => isMobileNavItemActive(i, pathname));

  return (
    <>
      <nav
        aria-label="Primary"
        data-testid="mobile-bottom-nav"
        className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden"
      >
        <ul className="mx-auto flex h-[var(--bottom-nav-bar)] max-w-lg items-stretch gap-0.5 px-1">
          {primary.map((item) => {
            const active = isMobileNavItemActive(item, pathname);
            return (
              // Plain Link, not NavLink: NavLink applies its own prefix
              // matching to aria-current ("/app" would match every page).
              <li key={item.key} className="flex min-w-0 flex-1">
                <Link
                  to={item.path}
                  aria-current={active ? "page" : undefined}
                  className={cn(TAB, active && "text-foreground")}
                >
                  <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors motion-reduce:transition-none", active && "bg-primary/10")}>
                    <item.icon className="h-5 w-5" aria-hidden="true" strokeWidth={active ? 2.4 : 2} />
                  </span>
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-label="More destinations"
              data-active={moreActive || undefined}
              className={cn(TAB, (moreActive || moreOpen) && "text-foreground")}
            >
              <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", moreActive && "bg-primary/10")}>
                <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
      <MobileMoreSheet open={moreOpen} onOpenChange={setMoreOpen} items={more} />
    </>
  );
}
