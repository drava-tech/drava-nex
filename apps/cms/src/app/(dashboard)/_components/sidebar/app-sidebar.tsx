"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import {
  LayoutDashboard,
  Monitor,
  Film,
  Cpu,
  // ScanFace,
  // PenTool,
  Settings2,
  CalendarClock,
  Send,
  // SquareTerminal,
  // Globe,
} from "lucide-react";
import { DravaLogo } from "@/components/drava-logo";
import { roleLabel } from "@/lib/roles";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@platform/ui";
import { useSession } from "@/lib/auth-client";
import { useGuestMode } from "./use-guest-mode";

const ALL_NAV = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
    roles: ["ADMIN", "GUEST"] as string[],
  },
  {
    title: "Our Story",
    url: "/broadcast",
    icon: Send,
    roles: ["ADMIN", "GUEST"] as string[],
    guestModeVisible: true,
  },
  {
    title: "Media",
    url: "/media",
    icon: Film,
    roles: ["ADMIN", "GUEST"] as string[],
    guestModeVisible: true,
  },
  {
    title: "Screens",
    url: "/screens",
    icon: Monitor,
    roles: ["ADMIN", "GUEST"] as string[],
    guestModeVisible: true,
  },
  {
    title: "Schedules",
    url: "/schedules",
    icon: CalendarClock,
    roles: ["ADMIN"] as string[],
  },
  {
    title: "Environment",
    url: "/environment",
    icon: Cpu,
    roles: ["ADMIN", "GUEST"] as string[],
    guestModeVisible: true,
  },
  // {
  //   title: "Experiences",
  //   url: "/experiences",
  //   icon: SquareTerminal,
  //   roles: ["ADMIN"] as string[],
  //   guestModeVisible: true,
  // },
  // {
  //   title: "Products",
  //   url: "/products",
  //   icon: Package,
  //   roles: ["ADMIN"] as string[],
  // },
  // {
  //   title: "Browser",
  //   url: "/browser",
  //   icon: Globe,
  //   roles: ["ADMIN", "GUEST"] as string[],
  //   guestModeVisible: true,
  // },
  // Hidden for now; restore together with the "Draw" item in
  // whiteboard/whiteboard-overlay.tsx.
  // {
  //   title: "Whiteboards",
  //   url: "/whiteboards",
  //   icon: PenTool,
  //   roles: ["ADMIN", "GUEST"] as string[],
  // },
  // {
  //   title: "Users",
  //   url: "/users",
  //   icon: Users,
  //   roles: ["ADMIN"] as string[],
  // },
  // {
  //   title: "Visitors",
  //   url: "/visitors",
  //   icon: ScanFace,
  //   roles: ["ADMIN"] as string[],
  // },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings2,
    roles: ["ADMIN"] as string[],
  },
];

const GUEST_NAV_ITEMS = ALL_NAV.filter((item) => item.guestModeVisible);
const GUEST_MODE_ROUTES = GUEST_NAV_ITEMS.map((item) => item.url);
const GUEST_MODE_HOME = GUEST_MODE_ROUTES[0] ?? "/experiences";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: sessionData, isPending } = useSession();
  const role = (sessionData?.user as { role?: string } | undefined)?.role ?? "GUEST";
  const effectiveRole = role === "SUPERADMIN" ? "ADMIN" : role;
  const [isGuestMode, toggleGuestMode] = useGuestMode();
  const pathname = usePathname();
  const router = useRouter();

  const navItems = isGuestMode ? GUEST_NAV_ITEMS : ALL_NAV.filter((item) => item.roles.includes(effectiveRole));

  React.useEffect(() => {
    if (!isGuestMode) return;
    const isAllowed = GUEST_MODE_ROUTES.some(
      (url) => pathname === url || pathname?.startsWith(`${url}/`)
    );
    if (!isAllowed) {
      router.replace(GUEST_MODE_HOME);
    }
  }, [isGuestMode, pathname, router]);

  const user = sessionData?.user
    ? {
      name: sessionData.user.name,
      email: sessionData.user.email,
      avatar: (sessionData.user as { image?: string | null }).image ?? "",
    }
    : { name: "Loading…", email: "", avatar: "" };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-20 items-center justify-center px-4 py-3 group-data-[collapsible=icon]:hidden">
        <DravaLogo product="nex" className="text-2xl" />
      </SidebarHeader>
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
        <NavUser
          user={user}
          isGuestMode={isGuestMode}
          onToggleGuestMode={effectiveRole === "ADMIN" ? toggleGuestMode : undefined}
          roleLabel={sessionData?.user ? roleLabel(role) : undefined}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
