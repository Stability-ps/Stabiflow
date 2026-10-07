import type { MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, CircleHelp, Download, Lock, LogOut, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GUIDE_PATH, isMobileNavItemActive, NAV_ITEMS, type MobileNavItem } from "@/lib/navigation";
import { MODULE_LOCK_INFO } from "@/lib/moduleLockInfo";
import type { FeatureFlagKey } from "@/lib/featureFlags";

const NAV_FLAG_BY_PATH = Object.fromEntries(NAV_ITEMS.filter((i) => i.flag).map((i) => [i.path, i.flag])) as Record<string, FeatureFlagKey>;
import { useAuth } from "@/hooks/useAuth";
import { useOverlayHistory } from "@/hooks/useOverlayHistory";
import { BottomSheet, BottomSheetContent } from "@/components/ui/bottom-sheet";
import { useWorkspaceSwitch } from "@/hooks/useWorkspaceSwitch";
import { usePwaInstall } from "@/hooks/usePwaInstall";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; items: MobileNavItem[]; lockedItems?: MobileNavItem[] };

export function MobileMoreSheet({ open, onOpenChange, items, lockedItems = [] }: Props) {
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
                      active && "bg-selected text-foreground [&>svg]:text-primary",
                    )}
                  >
                    <item.icon className="h-5 w-5" aria-hidden="true" />
                    <span className="line-clamp-2 leading-tight">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {lockedItems.length > 0 ? (
            <div className="mt-3 border-t px-1 pt-3">
              <p className="px-1 pb-1 text-overline uppercase text-muted-foreground">Not in your plan</p>
              <ul className="grid grid-cols-3 gap-1">
                {lockedItems.map((item) => {
                  const info = MODULE_LOCK_INFO[NAV_FLAG_BY_PATH[item.path]];
                  const explanation = info ? `Included in the ${info.plans}` : "Not included in your current plan";
                  return (
                    <li key={item.key}>
                      <Link
                        to={item.path}
                        onClick={go(item.path)}
                        aria-label={`${item.label} (locked). ${explanation}. View upgrade options`}
                        data-locked="true"
                        className="relative flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-center text-xs font-medium text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <item.icon className="h-5 w-5 text-locked" aria-hidden="true" />
                        <span className="line-clamp-2 leading-tight">{item.label}</span>
                        <Lock className="absolute right-2 top-2 h-3 w-3 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
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
                <span className="block text-sm font-medium">{pwa.installReady ? "Install StabiFlow" : "Prepare StabiFlow app"}</span>
                <span className="block text-xs text-muted-foreground">{pwa.installReady ? "Install the full app on this phone" : "Chrome is still preparing the full app install"}</span>
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
                  <p>Do not add a shortcut. Close this message, stay on <strong>app.stabiflow.com</strong> in Chrome and try <strong>Install StabiFlow</strong> again after Chrome finishes checking the app. A real install opens StabiFlow without the browser bar.</p>
                ) : (
                  <p>Open your browser menu and choose <strong>Install app</strong>. If that option is missing, the browser may still be checking install requirements.</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 border-t px-2 pt-3">
          <Link
            to={GUIDE_PATH}
            onClick={go(GUIDE_PATH)}
            aria-current={pathname.startsWith(GUIDE_PATH) ? "page" : undefined}
            className="flex min-h-12 items-center gap-3 rounded-xl px-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <CircleHelp className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Help & guide</span>
              <span className="block text-xs text-muted-foreground">Learn StabiFlow step by step</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </Link>
        </div>
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
