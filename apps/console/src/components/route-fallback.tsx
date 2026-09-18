import { Loader2Icon } from "lucide-react"

/**
 * Shown while a route loader resolves on first load (the session check), so
 * the page is never blank. React Router renders this as `HydrateFallback`.
 */
export function RouteFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Loading">
      <Loader2Icon className="text-muted-foreground size-6 animate-spin" />
    </div>
  )
}
