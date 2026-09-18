import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router"

import "@workspace/ui/globals.css"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { AppToaster } from "@/components/app-toaster"
import { ThemeProvider } from "@/components/theme-provider"
import { queryClient } from "@/lib/query-client"
import { router } from "@/router"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <AppToaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
