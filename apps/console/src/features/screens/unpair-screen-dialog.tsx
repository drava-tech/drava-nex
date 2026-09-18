import type { Screen } from "@workspace/types"

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
import { useUnpairScreen } from "./queries"

export function UnpairScreenDialog({
  screen,
  onOpenChange,
}: {
  screen: Screen | null
  onOpenChange: (open: boolean) => void
}) {
  const unpair = useUnpairScreen()

  async function confirm() {
    if (!screen) return
    try {
      await unpair.mutateAsync(screen.id)
      toast.success(`Unpaired “${screen.name}”`)
      onOpenChange(false)
    } catch (err) {
      toast.error("Could not unpair", { description: err instanceof Error ? err.message : undefined })
    }
  }

  return (
    <AlertDialog open={screen !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unpair “{screen?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The display is signed out immediately and stops receiving content. Use this when a
            display is lost, replaced or moved to another screen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={unpair.isPending}
            onClick={(e) => {
              e.preventDefault()
              void confirm()
            }}
          >
            Unpair
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
