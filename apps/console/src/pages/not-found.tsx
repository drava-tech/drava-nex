import { Link } from "react-router"

import { Button } from "@workspace/ui/components/button"

export function NotFoundPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-muted-foreground font-mono text-xs tracking-widest">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Button asChild variant="outline">
        <Link to="/">Back to overview</Link>
      </Button>
    </div>
  )
}
