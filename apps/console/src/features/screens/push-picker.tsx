import { useState } from "react"
import { CheckIcon, ListOrderedIcon, SearchIcon, SendIcon, XIcon } from "lucide-react"
import type { MediaItem } from "@workspace/types"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { MediaPreviewSurface } from "@/features/media/media-card"
import { useMediaList } from "@/features/media/queries"
import { useDebouncedValue } from "@/hooks/use-debounced-value"

type Props = {
  disabled?: boolean
  onPush: (item: MediaItem) => void
  onPushQueue: (items: MediaItem[]) => void
}

/**
 * Choose what to show. One click selects; selecting several turns the action
 * into "play as a queue", in the order they were picked.
 */
export function PushPicker({ disabled, onPush, onPushQueue }: Props) {
  const [search, setSearch] = useState("")
  const debounced = useDebouncedValue(search.trim())
  const list = useMediaList({ search: debounced || undefined })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const [selected, setSelected] = useState<MediaItem[]>([])

  const toggle = (item: MediaItem) =>
    setSelected((cur) => (cur.some((s) => s.id === item.id) ? cur.filter((s) => s.id !== item.id) : [...cur, item]))

  const go = () => {
    if (selected.length === 1) onPush(selected[0]!)
    else if (selected.length > 1) onPushQueue(selected)
    setSelected([])
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search media"
            className="pl-8"
            aria-label="Search media to push"
          />
        </div>
        {selected.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
            <XIcon />
            Clear
          </Button>
        )}
        <Button onClick={go} disabled={disabled || selected.length === 0} data-testid="push-selected">
          {selected.length > 1 ? <ListOrderedIcon /> : <SendIcon />}
          {selected.length > 1 ? `Play ${selected.length} as queue` : "Push to screen"}
        </Button>
      </div>

      <ScrollArea className="h-[22rem] rounded-md border">
        {list.isPending ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-video" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-sm">
            {debounced ? "Nothing matches." : "The media library is empty — upload something first."}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 p-3">
            {items.map((item) => {
              const order = selected.findIndex((s) => s.id === item.id)
              const isSelected = order !== -1
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item)}
                  aria-pressed={isSelected}
                  aria-label={`Select ${item.name}`}
                  className={cn(
                    "group bg-card grid overflow-hidden rounded-md border text-left transition",
                    isSelected ? "ring-primary ring-2" : "hover:border-foreground/30"
                  )}
                >
                  <div className="bg-muted relative aspect-video overflow-hidden">
                    <MediaPreviewSurface item={item} />
                    {isSelected && (
                      <Badge className="absolute top-1.5 right-1.5 size-6 justify-center rounded-full p-0">
                        {selected.length > 1 ? order + 1 : <CheckIcon className="size-3.5" />}
                      </Badge>
                    )}
                  </div>
                  <p className="truncate px-2 py-1.5 text-xs font-medium" title={item.name}>
                    {item.name}
                  </p>
                </button>
              )
            })}
          </div>
        )}
        {list.hasNextPage && (
          <div className="flex justify-center pb-3">
            <Button variant="outline" size="sm" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              Load more
            </Button>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
