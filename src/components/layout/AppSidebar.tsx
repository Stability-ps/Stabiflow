import type { MouseEvent } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, useSidebar,
} from "@/components/ui/sidebar";
import { useOverlayHistory } from "@/hooks/useOverlayHistory";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { isNavItemActive, NAV_ITEMS, type NavChild, type NavItem } from "@/lib/navigation";

function isChildActive(child: NavChild, pathname: string): boolean {
  if (child.external) return false;
  const childPath = child.to.split("?")[0];
  return pathname === childPath || pathname.startsWith(`${childPath}/`);
}

// `items` defaults to the full list; AppLayout passes the feature-flag
// filtered list (see filterNavItems) so this component stays a pure
// presentational list.
export function AppSidebar({ items = NAV_ITEMS }: { items?: NavItem[] }) {
  const { pathname } = useLocation();
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  // On phones the sidebar is a modal drawer. Selecting a destination must
  // close it in the same step (overlay, scroll lock and drawer state all
  // reset) and replace - not stack - the drawer's history entry; Back closes
  // the drawer before leaving the page. Desktop keeps plain NavLink behaviour.
  const { navigateFrom } = useOverlayHistory(isMobile && openMobile, () => setOpenMobile(false));
  const onNavigate = (to: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isMobile || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigateFrom(to);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        {/* BrandLogo's "full" variant is already the complete icon+wordmark
            lockup - rendering the standalone icon next to it duplicated
            the mark. Show exactly one brand presentation at a time: the
            full lockup when expanded, the icon alone when collapsed. */}
        <NavLink to="/app" onClick={onNavigate("/app")} className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <BrandLogo variant="icon" className="hidden h-7 w-7 shrink-0 group-data-[collapsible=icon]:block" />
          <BrandLogo variant="full" className="h-7 w-auto group-data-[collapsible=icon]:hidden" />
        </NavLink>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = isNavItemActive(item.path, pathname);
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild tooltip={item.label} isActive={active}>
                      <NavLink
                        to={item.path}
                        end={item.path === "/app"}
                        onClick={onNavigate(item.path)}
                        aria-current={active ? "page" : undefined}
                        className={active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium [&_svg]:text-sidebar-accent-foreground" : ""}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                    {item.children && active && (
                      <SidebarMenuSub aria-label={`${item.label} sections`}>
                        {item.children.map((child) => {
                          const childActive = isChildActive(child, pathname);
                          return (
                            <SidebarMenuSubItem key={child.to}>
                              <SidebarMenuSubButton asChild isActive={childActive}>
                                <NavLink
                                  to={child.to}
                                  onClick={onNavigate(child.to)}
                                  aria-current={childActive ? "page" : undefined}
                                  aria-label={`${item.label} ${child.label}`}
                                  title={child.external ? `Open ${child.label}, filtered to ${item.label}` : undefined}
                                >
                                  <span>{child.label}</span>
                                  {child.external && <span aria-hidden="true" className="ml-auto text-xs opacity-60">&#8599;</span>}
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-3 py-3 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
        Create. Advertise. Connect. Convert.
      </SidebarFooter>
    </Sidebar>
  );
}
