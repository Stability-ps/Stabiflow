import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { isNavItemActive, NAV_ITEMS, type NavChild } from "@/lib/navigation";

function isChildActive(child: NavChild, pathname: string): boolean {
  if (child.external) return false;
  const childPath = child.to.split("?")[0];
  return pathname === childPath || pathname.startsWith(`${childPath}/`);
}

export function AppSidebar() {
  const { pathname } = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        {/* BrandLogo's "full" variant is already the complete icon+wordmark
            lockup - rendering the standalone icon next to it duplicated
            the mark. Show exactly one brand presentation at a time: the
            full lockup when expanded, the icon alone when collapsed. */}
        <NavLink to="/app" className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <BrandLogo variant="icon" className="hidden h-7 w-7 shrink-0 group-data-[collapsible=icon]:block" />
          <BrandLogo variant="full" className="h-7 w-auto group-data-[collapsible=icon]:hidden" />
        </NavLink>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const active = isNavItemActive(item.path, pathname);
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild tooltip={item.label} isActive={active}>
                      <NavLink
                        to={item.path}
                        end={item.path === "/app"}
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
