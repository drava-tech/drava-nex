import { useState } from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import type { MediaItem } from "@workspace/types"

import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { useMediaList } from "@/features/media/queries"
import { useDebouncedValue } from "@/hooks/use-debounced-value"

/** Combobox for the item a screen shows when nothing is pushed to it. */
export function DefaultMediaPicker({
  value,
  disabled,
  onChange,
}: {
  value: MediaItem | null
  disabled?: boolean
  onChange: (mediaId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const debounced = useDebouncedValue(search.trim())
  const list = useMediaList({ search: debounced || undefined })
  // Only things that make sense on loop: images and video.
  const items = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((m) => m.type === "image" || m.type === "video")

  const choose = (id: string | null) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full justify-between">
          <span className="truncate">{value ? value.name : "Nothing (idle screen)"}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        {/* Filtering happens on the server, so cmdk's own filter is off. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search images and video…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{list.isPending ? "Loading…" : "No images or video found."}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__none__" onSelect={() => choose(null)}>
                <CheckIcon className={value ? "opacity-0" : ""} />
                Nothing (idle screen)
              </CommandItem>
              {items.map((item) => (
                <CommandItem key={item.id} value={item.id} onSelect={() => choose(item.id)}>
                  <CheckIcon className={value?.id === item.id ? "" : "opacity-0"} />
                  <span className="truncate">{item.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
