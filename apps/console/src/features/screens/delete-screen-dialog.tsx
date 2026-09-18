import { toast } from "@workspace/ui/components/sonner"

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
import { useDeleteScreen } from "./queries"

type Props = {
  screen: { id: string; name: string } | null
  onOpenChange: (open: boolean) => void
}

export function DeleteScreenDialog({ screen, onOpenChange }: Props) {
  const remove = useDeleteScreen()

  async function confirm() {
    if (!screen) return
    try {
      await remove.mutateAsync(screen.id)
      toast.success(`Deleted “${screen.name}”`)
      onOpenChange(false)
    } catch (err) {
      toast.error("Could not delete the screen", {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  return (
    <AlertDialog open={screen !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{screen?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The display is unpaired and stops receiving content. To use it again you will add it
            and pair it from scratch.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(e) => {
              // Keep the dialog open until the delete has actually happened.
              e.preventDefault()
              void confirm()
            }}
          >
            Delete screen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
