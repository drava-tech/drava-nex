import { CheckCircle2Icon, CircleAlertIcon, XIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardAction, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Progress } from "@workspace/ui/components/progress"
import { formatBytes } from "@/lib/format"
import type { UploadTask } from "./use-uploads"

const LABEL: Record<UploadTask["status"], string> = {
  queued: "Waiting…",
  preparing: "Preparing…",
  uploading: "Uploading",
  saving: "Saving…",
  done: "Uploaded",
  error: "Failed",
  cancelled: "Cancelled",
}

export function UploadList({
  tasks,
  onCancel,
  onClear,
}: {
  tasks: UploadTask[]
  onCancel: (id: string) => void
  onClear: () => void
}) {
  if (tasks.length === 0) return null
  const finished = tasks.filter((t) => ["done", "error", "cancelled"].includes(t.status)).length

  return (
    <Card className="gap-3 py-4" aria-label="Uploads">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">
          Uploads · {finished}/{tasks.length} finished
        </CardTitle>
        {finished > 0 && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear finished
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <ul className="grid gap-3 px-4">
        {tasks.map((t) => {
          const active = ["queued", "preparing", "uploading", "saving"].includes(t.status)
          return (
            <li key={t.id} className="grid gap-1.5" data-upload-status={t.status}>
              <div className="flex items-center gap-2 text-sm">
                {t.status === "done" && <CheckCircle2Icon className="size-4 text-emerald-600" />}
                {t.status === "error" && <CircleAlertIcon className="text-destructive size-4" />}
                <span className="min-w-0 flex-1 truncate">{t.file.name}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t.status === "uploading"
                    ? `${Math.round(t.progress * 100)}% of ${formatBytes(t.file.size)}`
                    : LABEL[t.status]}
                </span>
                {active && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => onCancel(t.id)}
                    aria-label={`Cancel ${t.file.name}`}
                  >
                    <XIcon />
                  </Button>
                )}
              </div>
              {active && <Progress value={t.progress * 100} className="h-1.5" />}
              {t.error && <p className="text-destructive text-xs">{t.error}</p>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
