"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronUp,
  Cpu,
  Film,
  LayoutDashboard,
  LogOut,
  Mail,
  Monitor,
  Package,
  PenTool,
  ScanFace,
  Search,
  Settings2,
  Sparkles,
  SquareTerminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@platform/ui";
import { signOut, useSession } from "@/lib/auth-client";
import { useGuestMode } from "./use-guest-mode";

type NavigationItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  roles: string[];
  guestModeVisible?: boolean;
};

// Keep the original navigation and permissions; only the presentation changes.
const ALL_NAV: NavigationItem[] = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
    roles: ["ADMIN", "GUEST"],
  },
  {
    title: "Experiences",
    url: "/experiences",
    icon: SquareTerminal,
    roles: ["ADMIN"],
    guestModeVisible: true,
  },
  {
    title: "Products",
    url: "/products",
    icon: Package,
    roles: ["ADMIN"],
  },
  {
    title: "Environment",
    url: "/environment",
    icon: Cpu,
    roles: ["ADMIN"],
    guestModeVisible: true,
  },
  {
    title: "Screens",
    url: "/screens",
    icon: Monitor,
    roles: ["ADMIN", "GUEST"],
    guestModeVisible: true,
  },
  {
    title: "Whiteboards",
    url: "/whiteboards",
    icon: PenTool,
    roles: ["ADMIN", "GUEST"],
  },
  {
    title: "Users",
    url: "/users",
    icon: Users,
    roles: ["ADMIN"],
  },
  {
    title: "Visitors",
    url: "/visitors",
    icon: ScanFace,
    roles: ["ADMIN"],
  },
  {
    title: "Media",
    url: "/media",
    icon: Film,
    roles: ["ADMIN"],
    guestModeVisible: true,
  },
  {
    title: "Email Media",
    url: "/media/email",
    icon: Mail,
    roles: ["ADMIN"],
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings2,
    roles: ["ADMIN"],
  },
];

const GUEST_NAV_ITEMS = ALL_NAV.filter((item) => item.guestModeVisible);
const GUEST_MODE_ROUTES = GUEST_NAV_ITEMS.map((item) => item.url);
const GUEST_MODE_HOME = GUEST_MODE_ROUTES[0] ?? "/experiences";

function TuskerMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-10 w-7 shrink-0 text-[#b9a4ff]"
      fill="none"
      viewBox="0 0 30 42"
    >
      <path d="M5 11 23 2v29L5 39V11Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 13v18l10-5V8L9 13Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.5 11.2v14.6M9.2 19.8l9.8-5M9.2 25.2l9.8-5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 32h18M10 39v-6M18 35.5V40" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: sessionData, isPending } = useSession();
  const role = (sessionData?.user as { role?: string } | undefined)?.role ?? "GUEST";
  const effectiveRole = role === "SUPERADMIN" ? "ADMIN" : role;
  const [isGuestMode, toggleGuestMode] = useGuestMode();
  const [query, setQuery] = React.useState("");
  const pathname = usePathname();
  const router = useRouter();

  const allowedItems = isGuestMode
    ? GUEST_NAV_ITEMS
    : ALL_NAV.filter((item) => item.roles.includes(effectiveRole));
  const navItems = allowedItems.filter((item) =>
    item.title.toLowerCase().includes(query.trim().toLowerCase())
  );

  React.useEffect(() => {
    if (!isGuestMode) return;
    const isAllowed = GUEST_MODE_ROUTES.some(
      (url) => pathname === url || pathname?.startsWith(`${url}/`)
    );
    if (!isAllowed) router.replace(GUEST_MODE_HOME);
  }, [isGuestMode, pathname, router]);

  async function handleLogout() {
    await signOut();
    router.push("/login");
  }

  const accessLabel = effectiveRole === "ADMIN" ? "Admin" : "Guest";

  return (
    <Sidebar
      collapsible="icon"
      className="!pb-[26px] !pl-8 !pr-1 !pt-[42px] [&_[data-sidebar=sidebar]]:overflow-hidden [&_[data-sidebar=sidebar]]:rounded-[28px] [&_[data-sidebar=sidebar]]:border [&_[data-sidebar=sidebar]]:border-[#8c73d8]/80 [&_[data-sidebar=sidebar]]:bg-[radial-gradient(circle_at_25%_10%,rgba(73,51,153,.24),transparent_31%),linear-gradient(150deg,#09081b_0%,#17152b_60%,#1d1b30_100%)] [&_[data-sidebar=sidebar]]:shadow-[inset_0_0_26px_rgba(120,91,220,.12),0_0_21px_rgba(94,55,206,.15)]"
      {...props}
    >
      <SidebarHeader className="gap-0 px-[19px] pb-0 pt-[15px] group-data-[collapsible=icon]:px-3">
        <Link
          href="/"
          className="flex h-[49px] items-center gap-3 px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <TuskerMark />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="whitespace-nowrap text-[16px] font-semibold leading-tight tracking-[0.24em] text-white">
              WHITE TUSKER
            </p>
            <p className="mt-0.5 whitespace-nowrap text-[11px] tracking-[0.26em] text-[#918ba0]">
              EXPERIENCE CENTRE
            </p>
          </div>
        </Link>

        <label className="mt-3 flex h-9 items-center gap-3 rounded-full bg-[linear-gradient(90deg,rgba(61,55,86,.62),rgba(39,34,65,.62))] px-4 text-[#c4becd] group-data-[collapsible=icon]:hidden">
          <Search className="size-5 shrink-0" strokeWidth={1.5} />
          <input
            aria-label="Search navigation"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#aaa4b4]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search..."
            type="search"
            value={query}
          />
        </label>

        <p className="mb-1 mt-3 px-5 text-[10px] uppercase tracking-[0.24em] text-[#898295] group-data-[collapsible=icon]:hidden">
          Navigation
        </p>
      </SidebarHeader>

      <SidebarContent className="px-[19px] pb-1 pt-0 group-data-[collapsible=icon]:px-3">
        <nav aria-label="Primary navigation" className="flex flex-col">
          {isPending ? (
            Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-[38px] animate-pulse rounded-full bg-white/[0.035]" />
            ))
          ) : navItems.length > 0 ? (
            navItems.map((item) => {
              const hasMoreSpecificMatch = allowedItems.some(
                (otherItem) =>
                  otherItem.url !== item.url &&
                  otherItem.url.startsWith(`${item.url}/`) &&
                  (pathname === otherItem.url || pathname?.startsWith(`${otherItem.url}/`))
              );
              const active =
                item.url === "/"
                  ? pathname === "/"
                  : !hasMoreSpecificMatch &&
                    (pathname === item.url || pathname?.startsWith(`${item.url}/`));

              return (
                <Link
                  key={item.title}
                  href={item.url}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-[38px] items-center gap-[18px] rounded-full px-[18px] text-[15px] text-[#eeeaf3] transition duration-200 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 ${
                    active
                      ? "border border-[#a78bff] bg-[linear-gradient(90deg,rgba(60,43,111,.72),rgba(78,67,119,.78))] shadow-[inset_0_0_18px_rgba(219,207,255,.19),0_0_12px_rgba(112,71,229,.16)]"
                      : "border border-transparent hover:bg-white/[0.055] hover:text-white"
                  }`}
                >
                  <item.icon className="size-[17px] shrink-0" strokeWidth={1.55} />
                  <span className="truncate group-data-[collapsible=icon]:hidden">{item.title}</span>
                </Link>
              );
            })
          ) : (
            <p className="px-4 py-3 text-sm text-[#918b9b] group-data-[collapsible=icon]:hidden">
              No navigation matches
            </p>
          )}
        </nav>
      </SidebarContent>

      <SidebarFooter className="px-[19px] pb-[20px] pt-1 group-data-[collapsible=icon]:px-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="relative flex h-[50px] w-full items-center justify-center gap-3 rounded-full border border-[#9f7aff] bg-[linear-gradient(180deg,rgba(61,54,90,.83),rgba(44,38,68,.9))] px-5 text-[17px] text-[#ae8dff] shadow-[inset_0_0_18px_rgba(255,255,255,.12),0_0_16px_rgba(117,73,239,.24)] transition hover:brightness-125 group-data-[collapsible=icon]:px-0"
            >
              <span className="group-data-[collapsible=icon]:hidden">{accessLabel}</span>
              <ChevronUp
                className="absolute right-6 size-5 group-data-[collapsible=icon]:static"
                strokeWidth={1.7}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-60 border-[#6650a5] bg-[#17132c] text-[#eeeaf7]"
            side="right"
            sideOffset={12}
          >
            <DropdownMenuItem
              onClick={toggleGuestMode}
              className="cursor-pointer focus:bg-[#302654] focus:text-white"
            >
              <Sparkles />
              {isGuestMode ? "Switch to full mode" : "Switch to guest mode"}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem
              onClick={handleLogout}
              className="cursor-pointer focus:bg-[#302654] focus:text-white"
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
      <SidebarRail className="opacity-0 hover:opacity-100" />
    </Sidebar>
  );
}
