import { Outlet, useMatches, useNavigation } from "react-router"

import { Separator } from "@workspace/ui/components/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@workspace/ui/components/sidebar"
import { cn } from "@workspace/ui/lib/utils"
import { AppSidebar } from "@/components/app-sidebar"
import { ModeToggle } from "@/components/mode-toggle"
import type { RouteHandle } from "@/router"

export function DashboardLayout() {
  const matches = useMatches()
  const navigation = useNavigation()
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
          <div className="ml-auto">
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
