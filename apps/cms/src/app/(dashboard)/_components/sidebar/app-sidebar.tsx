"use client";

import * as React from "react";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import {
  LayoutDashboard,
  Monitor,
  SquareTerminal,
  Users,
  Film,
  Cpu,
  Package,
  ScanFace,
  PenTool,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@platform/ui";
import { useSession } from "@/lib/auth-client";

const ALL_NAV = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
    roles: ["ADMIN", "GUEST"] as string[],
  },
  {
    title: "Experiences",
    url: "/experiences",
    icon: SquareTerminal,
    roles: ["ADMIN"] as string[]
  },
  // {
  //   title: "Experience 2",
  //   url: "/experiences2",
  //   icon: Sparkles,
  //   roles: ["ADMIN"] as string[]
  // },
  {
    title: "Products",
    url: "/products",
    icon: Package,
    roles: ["ADMIN"] as string[],
  },
  // {
  //   title: "Environment 4",
  //   url: "/environment4",
  //   icon: Cpu,
  //   roles: ["ADMIN"] as string[],
  // },
  // {
  //   title: "Environment 6",
  //   url: "/environment6",
  //   icon: Cpu,
  //   roles: ["ADMIN"] as string[],
  // },
  {
    title: "Environment",
    url: "/environment",
    icon: Cpu,
    roles: ["ADMIN"] as string[],
  },
  {
    title: "Screens",
    url: "/screens",
    icon: Monitor,
    roles: ["ADMIN", "GUEST"] as string[],
  },
  {
    title: "Whiteboards",
    url: "/whiteboards",
    icon: PenTool,
    roles: ["ADMIN", "GUEST"] as string[],
  },
  {
    title: "Users",
    url: "/users",
    icon: Users,
    roles: ["ADMIN"] as string[],
  },
  {
    title: "Visitors",
    url: "/visitors",
    icon: ScanFace,
    roles: ["ADMIN"] as string[],
  },
  {
    title: "Media",
    url: "/media",
    icon: Film,
    roles: ["ADMIN"] as string[],
  },
  // {
  //   title: "Settings",
  //   url: "/settings",
  //   icon: Settings2,
  //   roles: ["ADMIN"] as string[],
  // },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: sessionData, isPending } = useSession();
  const role = (sessionData?.user as { role?: string } | undefined)?.role ?? "GUEST";
  const effectiveRole = role === "SUPERADMIN" ? "ADMIN" : role;

  const navItems = ALL_NAV.filter((item) => item.roles.includes(effectiveRole));

  const user = sessionData?.user
    ? {
      name: sessionData.user.name,
      email: sessionData.user.email,
      avatar: (sessionData.user as { image?: string | null }).image ?? "",
    }
    : { name: "Loading…", email: "", avatar: "" };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarContent>
        {isPending ? (
          <SidebarGroup>
            <SidebarMenu>
              {Array.from({ length: 6 }).map((_, i) => (
                <SidebarMenuItem key={i}>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : (
          <NavMain items={navItems} />
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
