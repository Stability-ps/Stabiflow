import { Bell } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher";
import { UserMenu } from "@/components/layout/UserMenu";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useAutomations";
import { markNotificationRead } from "@/lib/automations";

export function AppHeader() {
  const { currentWorkspaceId, user } = useAuth();
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
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger />
      <div className="flex-1" />
      <WorkspaceSwitcher />
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Notifications" className="relative text-muted-foreground">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <Badge variant="destructive" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full p-0 text-[10px]">
                {unreadCount > 9 ? "9+" : unreadCount}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
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
    </header>
  );
}
