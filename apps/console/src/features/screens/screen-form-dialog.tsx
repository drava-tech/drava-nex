import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "@workspace/ui/components/sonner"
import { createScreenRequestSchema, type CreateScreenRequest } from "@workspace/types"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { useCreateScreen, useRenameScreen } from "./queries"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Rename this screen; omit to create a new one. */
  screen?: { id: string; name: string }
}

export function ScreenFormDialog({ open, onOpenChange, screen }: Props) {
  const create = useCreateScreen()
  const rename = useRenameScreen()
  const editing = Boolean(screen)

  const form = useForm<CreateScreenRequest>({
    resolver: zodResolver(createScreenRequestSchema),
    defaultValues: { name: screen?.name ?? "" },
  })

  // Reset whenever the dialog opens, so it never shows a previous edit.
  useEffect(() => {
    if (open) form.reset({ name: screen?.name ?? "" })
  }, [open, screen?.name, form])

  async function onSubmit(values: CreateScreenRequest) {
    try {
      if (screen) {
        await rename.mutateAsync({ id: screen.id, name: values.name })
        toast.success("Screen renamed")
      } else {
        await create.mutateAsync(values)
        toast.success(`Added “${values.name}”`, {
          description: "Pair it with a display to start pushing content.",
        })
      }
      onOpenChange(false)
    } catch (err) {
      form.setError("name", { message: err instanceof Error ? err.message : "Save failed" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Rename screen" : "Add screen"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "The new name shows up everywhere immediately."
                : "Create the screen here, then pair the physical display with a code."}
            </DialogDescription>
          </DialogHeader>
          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="screen-name">Name</FieldLabel>
                <Input
                  {...field}
                  id="screen-name"
                  placeholder="Lobby wall"
                  autoComplete="off"
                  autoFocus
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>Where it is, so anyone can find it.</FieldDescription>
                )}
              </Field>
            )}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {editing ? "Save" : "Add screen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
