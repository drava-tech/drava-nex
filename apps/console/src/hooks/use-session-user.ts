import { useRouteLoaderData } from "react-router"

import type { requireSessionLoader } from "@/lib/session"

/** The signed-in user, as resolved by the dashboard route loader. */
export function useSessionUser() {
  const data = useRouteLoaderData<typeof requireSessionLoader>("dashboard")
  if (!data) throw new Error("useSessionUser must be used inside the dashboard route")
  return data.user
}
