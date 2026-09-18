import { Outlet, useMatches, useNavigation } from "react-router"

import { Separator } from "@workspace/ui/components/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@workspace/ui/components/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { AppSidebar } from "@/components/app-sidebar"
import { ModeToggle } from "@/components/mode-toggle"
import { useLiveUpdates, type LiveStatus } from "@/hooks/use-live-updates"
import type { RouteHandle } from "@/router"

const LIVE_LABEL: Record<LiveStatus, { text: string; hint: string; dot: string }> = {
  live: { text: "Live", hint: "Changes from other people and screens appear instantly.", dot: "bg-emerald-500" },
  connecting: { text: "Connecting", hint: "Opening the live connection…", dot: "bg-amber-500" },
  offline: { text: "Reconnecting", hint: "Live updates are paused; retrying automatically.", dot: "bg-amber-500 animate-pulse" },
}

function LiveIndicator({ status }: { status: LiveStatus }) {
  const l = LIVE_LABEL[status]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs" data-live-status={status}>
          <span className={cn("size-2 rounded-full", l.dot)} aria-hidden />
          {l.text}
        </span>
      </TooltipTrigger>
      <TooltipContent>{l.hint}</TooltipContent>
    </Tooltip>
  )
}

export function DashboardLayout() {
  const matches = useMatches()
  const navigation = useNavigation()
  const live = useLiveUpdates()
  const handle = [...matches]
    .reverse()
    .map((m) => m.handle as RouteHandle | undefined)
    .find((h) => h?.title)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-center" />
          <h1 className="text-sm font-medium">{handle?.title}</h1>
          <div className="ml-auto flex items-center gap-3">
            <LiveIndicator status={live} />
            <ModeToggle />
          </div>
        </header>
        <main
          className={cn(
            "flex flex-1 flex-col gap-4 p-4 transition-opacity md:p-6",
            navigation.state === "loading" && "opacity-60"
          )}
        >
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
