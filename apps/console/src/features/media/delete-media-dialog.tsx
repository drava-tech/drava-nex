import type { MediaItem } from "@workspace/types"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { toast } from "@workspace/ui/components/sonner"
import { useDeleteMedia } from "./queries"

export function DeleteMediaDialog({
  item,
  onOpenChange,
}: {
  item: MediaItem | null
  onOpenChange: (open: boolean) => void
}) {
  const remove = useDeleteMedia()

  async function confirm() {
    if (!item) return
    try {
      const res = await remove.mutateAsync(item.id)
      toast.success(`Deleted “${item.name}”`, {
        description: res.affectedScreens
          ? `Removed from ${res.affectedScreens} screen${res.affectedScreens === 1 ? "" : "s"}.`
          : undefined,
      })
      onOpenChange(false)
    } catch (err) {
      toast.error("Could not delete", { description: err instanceof Error ? err.message : undefined })
    }
  }

  return (
    <AlertDialog open={item !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{item?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The file is removed from storage. Any screen showing it, or holding it in a queue or as
            its default, drops it straight away.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(e) => {
              e.preventDefault()
              void confirm()
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
