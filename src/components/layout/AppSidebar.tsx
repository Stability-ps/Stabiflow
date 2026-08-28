import { NavLink } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { NAV_ITEMS } from "@/lib/navigation";

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        {/* BrandLogo's "full" variant is already the complete icon+wordmark
            lockup - rendering the standalone icon next to it duplicated
            the mark. Show exactly one brand presentation at a time: the
            full lockup when expanded, the icon alone when collapsed. */}
        <NavLink to="/" className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <BrandLogo variant="icon" className="hidden h-7 w-7 shrink-0 group-data-[collapsible=icon]:block" />
          <BrandLogo variant="full" className="h-7 w-auto group-data-[collapsible=icon]:hidden" />
        </NavLink>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild tooltip={item.label}>
                    <NavLink
                      to={item.path}
                      end={item.path === "/"}
                      className={({ isActive }) =>
                        isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : ""
                      }
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
