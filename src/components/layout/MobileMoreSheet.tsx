import type { MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Download, LogOut, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isMobileNavItemActive, type MobileNavItem } from "@/lib/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useOverlayHistory } from "@/hooks/useOverlayHistory";
import { BottomSheet, BottomSheetContent } from "@/components/ui/bottom-sheet";
import { useWorkspaceSwitch } from "@/hooks/useWorkspaceSwitch";
import { usePwaInstall } from "@/hooks/usePwaInstall";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; items: MobileNavItem[] };

export function MobileMoreSheet({ open, onOpenChange, items }: Props) {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const { currentMembership, memberships } = useWorkspaceSwitch();
  const { navigateFrom } = useOverlayHistory(open, () => onOpenChange(false));
  const pwa = usePwaInstall();

  const go = (to: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigateFrom(to);
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent title="More" data-testid="mobile-more-sheet">
        <nav aria-label="More destinations">
          <ul className="grid grid-cols-3 gap-1">
            {items.map((item) => {
              const active = isMobileNavItemActive(item, pathname);
              return (
                <li key={item.key}>
                  <Link
                    to={item.path}
                    onClick={go(item.path)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-center text-xs font-medium text-foreground/80",
                      "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active && "bg-primary/10 text-foreground",
                    )}
                  >
                    <item.icon className="h-5 w-5" aria-hidden="true" />
                    <span className="line-clamp-2 leading-tight">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {pwa.canInstall ? (
          <div className="mt-3 border-t px-2 pt-3">
            <button
              type="button"
              onClick={() => void pwa.install()}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Download className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Install StabiFlow</span>
                <span className="block text-xs text-muted-foreground">Open without the browser bar</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>
            {pwa.showHelp ? (
              <div className="relative mt-2 rounded-xl bg-muted p-3 pr-10 text-sm">
                <button type="button" aria-label="Dismiss install help" onClick={pwa.dismissHelp} className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
                {pwa.isiOS ? (
                  <p><Share2 className="mr-1 inline h-4 w-4" aria-hidden="true" />In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</p>
                ) : pwa.isAndroid ? (
                  <p>For the full app experience, open this page directly in <strong>Chrome</strong>, then use <strong>Install app</strong>. If Chrome only offers <strong>Add to Home screen</strong>, it is creating a shortcut rather than installing the PWA.</p>
                ) : (
                  <p>Open your browser menu and choose <strong>Install app</strong>. If that option is missing, the browser may still be checking install requirements.</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        {memberships.length > 0 ? (
          <div className="mt-3 border-t px-2 pt-3">
            <Link
              to="/app/settings"
              onClick={go("/app/settings")}
              className="flex min-h-12 items-center gap-3 rounded-xl px-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">Workspace</span>
                <span className="block truncate text-sm font-medium">{currentMembership?.workspace.name ?? "Workspace"}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={() => { onOpenChange(false); void signOut(); }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-sm text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        ) : null}
      </BottomSheetContent>
    </BottomSheet>
  );
}
