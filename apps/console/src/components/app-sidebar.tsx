import * as React from "react"
import { Link, useNavigate } from "react-router"
import { ImagesIcon, LayoutDashboardIcon, MonitorIcon, MonitorPlayIcon } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@workspace/ui/components/sidebar"
import { NavMain, type NavItem } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { useSessionUser } from "@/hooks/use-session-user"
import { authClient } from "@/lib/auth-client"
import { queryClient } from "@/lib/query-client"

const NAV: NavItem[] = [
  { title: "Overview", url: "/", icon: <LayoutDashboardIcon /> },
  { title: "Media", url: "/media", icon: <ImagesIcon /> },
  { title: "Screens", url: "/screens", icon: <MonitorIcon /> },
]

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const user = useSessionUser()
  const navigate = useNavigate()

  async function signOut() {
    await authClient.signOut()
    // Nothing cached for this user may survive into the next session.
    queryClient.clear()
    navigate("/login", { replace: true })
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <MonitorPlayIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Push</span>
                  <span className="text-muted-foreground truncate text-xs">Content to screens</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={NAV} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onSignOut={signOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
