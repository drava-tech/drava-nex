import type { Screen } from "@workspace/types"

import { Badge } from "@workspace/ui/components/badge"

/** One badge that answers "can I push to this screen right now?". */
export function ScreenStatus({ screen }: { screen: Pick<Screen, "paired" | "online"> }) {
  if (!screen.paired) {
    return <Badge variant="outline">Not paired</Badge>
  }
  if (screen.online) {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        <span className="size-1.5 rounded-full bg-white" aria-hidden />
        Online
      </Badge>
    )
  }
  return <Badge variant="secondary">Offline</Badge>
}
