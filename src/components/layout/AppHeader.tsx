import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronDown, ChevronLeft } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher";
import { UserMenu } from "@/components/layout/UserMenu";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { MobileWorkspaceSheet } from "@/components/layout/MobileWorkspaceSheet";
import { mobilePageMeta } from "@/lib/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useAutomations";
import { markNotificationRead } from "@/lib/automations";

export function AppHeader() {
  const { currentWorkspaceId, currentMembership, user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const meta = mobilePageMeta(pathname);
  const [workspaceSheet, setWorkspaceSheet] = useState(false);
  const { data: notifications, refetch } = useNotifications(currentWorkspaceId, user?.id ?? null);
  const unreadCount = (notifications || []).filter((n) => !n.read_at).length;

  async function handleOpenChange(open: boolean) {
    if (open || !notifications) return;
    const unread = notifications.filter((n) => !n.read_at);
    if (unread.length === 0) return;
    await Promise.all(unread.map((n) => markNotificationRead(n.id)));
    refetch();
  }

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-14 items-center gap-1 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] md:gap-3 md:px-4">
        {/* Desktop/tablet: sidebar toggle + workspace dropdown (unchanged). */}
        <SidebarTrigger className="hidden md:inline-flex" />
        {/* Phone: contextual back (or brand mark) + page title, with the
            workspace as a quiet secondary line that opens a bottom sheet. */}
        <div className="flex min-w-0 flex-1 items-center gap-1 md:hidden">
          {meta.parent ? (
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Back" onClick={() => navigate(meta.parent!)}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
          ) : (
            <span className="flex h-11 w-9 shrink-0 items-center justify-center"><BrandLogo variant="icon" className="h-7 w-7" /></span>
          )}
          <button
            type="button"
            onClick={() => setWorkspaceSheet(true)}
            className="flex min-h-11 min-w-0 flex-col items-start justify-center rounded-lg px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${meta.title}. Workspace ${currentMembership?.workspace.name ?? ""}. Switch workspace`}
            data-testid="mobile-page-title"
          >
            <span className="max-w-full truncate text-base font-semibold leading-tight">{meta.title}</span>
            <span className="flex max-w-full items-center gap-0.5 text-xs leading-tight text-muted-foreground">
              <span className="truncate">{currentMembership?.workspace.name ?? "Workspace"}</span>
              <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
            </span>
          </button>
        </div>
        <div className="hidden flex-1 md:block" />
        <div className="hidden md:block"><WorkspaceSwitcher /></div>
        <DropdownMenu onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Notifications" className="relative shrink-0 text-muted-foreground">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <Badge variant="destructive" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full p-0 text-[10px]">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[70dvh] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(notifications || []).length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">Nothing yet - automations you enable can notify you here.</p>}
            {(notifications || []).slice(0, 10).map((n) => (
              <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-0.5 whitespace-normal">
                <span className="text-sm font-medium">{n.title}</span>
                {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
                <span className="text-[10px] text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <UserMenu />
      </div>
      <MobileWorkspaceSheet open={workspaceSheet} onOpenChange={setWorkspaceSheet} />
    </header>
  );
}
