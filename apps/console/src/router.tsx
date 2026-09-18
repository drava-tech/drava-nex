import { createBrowserRouter } from "react-router"

import { RouteFallback } from "@/components/route-fallback"
import { DashboardLayout } from "@/layouts/dashboard-layout"
import { NotFoundPage } from "@/pages/not-found"
import { redirectIfSignedInLoader, requireSessionLoader } from "@/lib/session"

export type RouteHandle = { title: string }

// Data mode (createBrowserRouter): every page is a `lazy` route, so each one is
// its own chunk — and the screen player (M11) never downloads the admin UI.
export const router = createBrowserRouter([
  {
    path: "/login",
    loader: redirectIfSignedInLoader,
    HydrateFallback: RouteFallback,
    lazy: async () => ({ Component: (await import("@/pages/login")).LoginPage }),
  },
  {
    id: "dashboard",
    path: "/",
    loader: requireSessionLoader,
    HydrateFallback: RouteFallback,
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
      {
        path: "screens/:screenId",
        handle: { title: "Screen" } satisfies RouteHandle,
        lazy: async () => ({ Component: (await import("@/pages/screen-control")).ScreenControlPage }),
      },
    ],
  },
  // Displays: public, outside the dashboard, so a screen never loads the admin UI.
  {
    path: "/display/:screenId?",
    lazy: async () => ({ Component: (await import("@/pages/display")).DisplayPage }),
  },
  { path: "*", Component: NotFoundPage },
])
