"use client";

import * as React from "react";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import {
  LayoutDashboard,
  Monitor,
  Settings2,
  SquareTerminal,
  Users,
  Film,
  Cpu,
} from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarRail } from "@platform/ui";
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
    url: "/projects",
    icon: SquareTerminal,
    roles: ["ADMIN"] as string[]
  },
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
    title: "Users",
    url: "/users",
    icon: Users,
    roles: ["ADMIN"] as string[],
  },
  {
    title: "Media",
    url: "/media",
    icon: Film,
    roles: ["ADMIN"] as string[],
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings2,
    roles: ["ADMIN"] as string[],
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: sessionData } = useSession();
  const role = (sessionData?.user as { role?: string } | undefined)?.role ?? "GUEST";

  const navItems = ALL_NAV.filter((item) => item.roles.includes(role));

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
        <NavMain items={navItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
