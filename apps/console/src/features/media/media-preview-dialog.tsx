import { ExternalLinkIcon } from "lucide-react"
import type { MediaItem } from "@workspace/types"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { formatBytes } from "@/lib/format"
import { MEDIA_ICONS, MEDIA_LABELS } from "./media-icon"

export function MediaPreviewDialog({
  item,
  onOpenChange,
}: {
  item: MediaItem | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-6">{item.name}</DialogTitle>
              <DialogDescription>
                {MEDIA_LABELS[item.type]}
                {item.sizeBytes != null && ` · ${formatBytes(item.sizeBytes)}`}
                {` · added ${new Date(item.createdAt).toLocaleString()}`}
              </DialogDescription>
            </DialogHeader>
            <div className="bg-muted flex max-h-[70vh] min-h-64 items-center justify-center overflow-hidden rounded-md">
              <PreviewBody item={item} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PreviewBody({ item }: { item: MediaItem }) {
  if (item.type === "image") {
    return <img src={item.url} alt={item.name} className="max-h-[70vh] object-contain" />
  }
  if (item.type === "video") {
    return <video src={item.url} controls autoPlay muted playsInline className="max-h-[70vh] w-full" />
  }
  if (item.type === "document") {
    return <iframe src={item.url} title={item.name} className="h-[70vh] w-full bg-white" />
  }
  const Icon = MEDIA_ICONS[item.type]
  return (
    <div className="flex flex-col items-center gap-4 p-10 text-center">
      <Icon className="text-muted-foreground size-12" strokeWidth={1.25} />
      <p className="text-muted-foreground text-sm">
        {item.type === "link"
          ? item.url
          : "This file renders full-screen on a display. Open it to check the contents."}
      </p>
      <Button asChild variant="outline">
        <a href={item.url} target="_blank" rel="noreferrer">
          <ExternalLinkIcon />
          Open
        </a>
      </Button>
    </div>
  )
}
