import { createBrowserRouter } from "react-router"

import { DashboardLayout } from "@/layouts/dashboard-layout"
import { NotFoundPage } from "@/pages/not-found"

export type RouteHandle = { title: string }

// Data mode (createBrowserRouter): every page is a `lazy` route, so each one is
// its own chunk — and the screen player (M11) never downloads the admin UI.
export const router = createBrowserRouter([
  {
    path: "/",
    Component: DashboardLayout,
    children: [
      {
        index: true,
        handle: { title: "Overview" } satisfies RouteHandle,
        lazy: async () => ({ Component: (await import("@/pages/overview")).OverviewPage }),
      },
      {
        path: "media",
        handle: { title: "Media" } satisfies RouteHandle,
        lazy: async () => ({ Component: (await import("@/pages/media")).MediaPage }),
      },
      {
        path: "screens",
        handle: { title: "Screens" } satisfies RouteHandle,
        lazy: async () => ({ Component: (await import("@/pages/screens")).ScreensPage }),
      },
    ],
  },
  { path: "*", Component: NotFoundPage },
])
