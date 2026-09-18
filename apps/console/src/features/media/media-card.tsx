import { EyeIcon, MoreVerticalIcon, Trash2Icon } from "lucide-react"
import type { MediaItem } from "@workspace/types"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { formatBytes } from "@/lib/format"
import { MEDIA_ICONS, MEDIA_LABELS } from "./media-icon"

export function MediaPreviewSurface({ item }: { item: MediaItem }) {
  const Icon = MEDIA_ICONS[item.type]
  if (item.thumbnailUrl || item.type === "image") {
    return (
      <img
        src={item.thumbnailUrl ?? item.url}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full object-cover"
      />
    )
  }
  if (item.type === "video") {
    // No poster tile: let the browser paint the first frame from metadata only.
    return <video src={item.url} preload="metadata" muted playsInline className="size-full object-cover" />
  }
  return (
    <div className="text-muted-foreground flex size-full items-center justify-center">
      <Icon className="size-10" strokeWidth={1.25} />
    </div>
  )
}

type Props = {
  item: MediaItem
  canManage: boolean
  onPreview: (item: MediaItem) => void
  onDelete: (item: MediaItem) => void
}

export function MediaCard({ item, canManage, onPreview, onDelete }: Props) {
  return (
    <Card className="group gap-0 overflow-hidden p-0">
      <button
        type="button"
        onClick={() => onPreview(item)}
        className="bg-muted relative aspect-video w-full overflow-hidden focus-visible:outline-2"
        aria-label={`Preview ${item.name}`}
      >
        <MediaPreviewSurface item={item} />
        <Badge variant="secondary" className="absolute top-2 left-2 shadow-sm">
          {MEDIA_LABELS[item.type]}
        </Badge>
      </button>
      <div className="flex items-center gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={item.name}>
            {item.name}
          </p>
          <p className="text-muted-foreground text-xs">
            {item.type === "link" ? new URL(item.url).hostname : formatBytes(item.sizeBytes)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${item.name}`}>
              <MoreVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onPreview(item)}>
              <EyeIcon />
              Preview
            </DropdownMenuItem>
            {canManage && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(item)}>
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  )
}
