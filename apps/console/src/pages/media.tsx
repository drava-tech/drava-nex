import { useCallback, useRef, useState } from "react"
import { ImagesIcon, LinkIcon, SearchIcon, UploadIcon } from "lucide-react"
import { classifyUpload, UPLOAD_ACCEPT, type MediaItem, type MediaType } from "@workspace/types"

import { Button } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"
import { AddLinkDialog } from "@/features/media/add-link-dialog"
import { DeleteMediaDialog } from "@/features/media/delete-media-dialog"
import { MediaCard } from "@/features/media/media-card"
import { MediaPreviewDialog } from "@/features/media/media-preview-dialog"
import { useMediaList } from "@/features/media/queries"
import { UploadList } from "@/features/media/upload-list"
import { useUploads } from "@/features/media/use-uploads"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useSessionUser } from "@/hooks/use-session-user"

const FILTERS: { value: "all" | MediaType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Video" },
  { value: "document", label: "PDF" },
  { value: "presentation", label: "Slides" },
  { value: "link", label: "Links" },
]

export function MediaPage() {
  const user = useSessionUser()
  const canManage = user.role === "ADMIN"

  const [filter, setFilter] = useState<"all" | MediaType>("all")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search.trim())
  const list = useMediaList({ type: filter === "all" ? undefined : filter, search: debouncedSearch || undefined })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  const uploads = useUploads()
  const fileInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<MediaItem | null>(null)
  const [deleting, setDeleting] = useState<MediaItem | null>(null)
  const [addingLink, setAddingLink] = useState(false)

  const accept = useCallback(
    (files: FileList | File[]) => {
      const all = Array.from(files)
      const ok = all.filter((f) => classifyUpload(f.name))
      const rejected = all.length - ok.length
      if (rejected) {
        toast.error(`${rejected} file${rejected === 1 ? "" : "s"} skipped`, {
          description: "Only images, video, PDF, XLSX/CSV, PPTX and DOCX can be shown on a screen.",
        })
      }
      if (ok.length) uploads.add(ok)
    },
    [uploads]
  )

  return (
    <div
      className="relative flex flex-1 flex-col gap-4"
      onDragOver={(e) => {
        if (!canManage || !e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => {
        if (!canManage) return
        e.preventDefault()
        setDragging(false)
        accept(e.dataTransfer.files)
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Media library</h2>
          <p className="text-muted-foreground text-sm">
            Stored in the cloud and streamed straight to every screen.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAddingLink(true)}>
              <LinkIcon />
              Add link
            </Button>
            <Button onClick={() => fileInput.current?.click()}>
              <UploadIcon />
              Upload
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={UPLOAD_ACCEPT}
              className="hidden"
              data-testid="file-input"
              onChange={(e) => {
                if (e.target.files) accept(e.target.files)
                e.target.value = ""
              }}
            />
          </div>
        )}
      </div>

      <UploadList tasks={uploads.tasks} onCancel={uploads.cancel} onClear={uploads.clearFinished} />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full sm:w-64">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            className="pl-8"
            aria-label="Search media"
          />
        </div>
      </div>

      {list.isError ? (
        <Card className="p-6">
          <p className="text-destructive text-sm">Could not load media: {list.error.message}</p>
          <Button variant="outline" className="mt-3 w-fit" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </Card>
      ) : list.isPending ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Card key={i} className="gap-0 overflow-hidden p-0">
              <Skeleton className="aspect-video rounded-none" />
              <div className="grid gap-2 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ImagesIcon />
              </EmptyMedia>
              <EmptyTitle>{debouncedSearch || filter !== "all" ? "Nothing matches" : "No media yet"}</EmptyTitle>
              <EmptyDescription>
                {debouncedSearch || filter !== "all"
                  ? "Try another search or filter."
                  : canManage
                    ? "Drop files anywhere on this page, or use Upload."
                    : "An admin needs to upload media first."}
              </EmptyDescription>
            </EmptyHeader>
            {canManage && !debouncedSearch && filter === "all" && (
              <EmptyContent>
                <Button onClick={() => fileInput.current?.click()}>
                  <UploadIcon />
                  Upload files
                </Button>
              </EmptyContent>
            )}
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
            {items.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                canManage={canManage}
                onPreview={setPreview}
                onDelete={setDeleting}
              />
            ))}
          </div>
          {list.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </>
      )}

      {dragging && (
        <div
          className={cn(
            "border-primary bg-background/80 pointer-events-none absolute inset-0 z-10 flex items-center justify-center",
            "rounded-xl border-2 border-dashed backdrop-blur-sm"
          )}
        >
          <p className="flex items-center gap-2 text-lg font-medium">
            <UploadIcon className="size-5" />
            Drop to upload
          </p>
        </div>
      )}

      <MediaPreviewDialog item={preview} onOpenChange={(open) => !open && setPreview(null)} />
      <DeleteMediaDialog item={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
      <AddLinkDialog open={addingLink} onOpenChange={setAddingLink} />
    </div>
  )
}
