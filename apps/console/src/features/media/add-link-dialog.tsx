import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import * as z from "zod"

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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { useCreateLink } from "./queries"

const schema = z.object({
  url: z.url({ protocol: /^https?$/, message: "Enter a full http(s) address" }),
  name: z.string().max(255).optional(),
})
type Values = z.infer<typeof schema>

export function AddLinkDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateLink()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { url: "", name: "" } })

  useEffect(() => {
    if (open) form.reset({ url: "", name: "" })
  }, [open, form])

  async function onSubmit(values: Values) {
    try {
      await create.mutateAsync({ url: values.url, ...(values.name?.trim() ? { name: values.name.trim() } : {}) })
      toast.success("Link added")
      onOpenChange(false)
    } catch (err) {
      form.setError("url", { message: err instanceof Error ? err.message : "Could not add the link" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a web link</DialogTitle>
            <DialogDescription>The page is shown full-screen on the display.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Controller
              name="url"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="link-url">Address</FieldLabel>
                  <Input {...field} id="link-url" placeholder="https://" autoFocus aria-invalid={fieldState.invalid} />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>
                      Some sites refuse to be shown inside another page and will stay blank.
                    </FieldDescription>
                  )}
                </Field>
              )}
            />
            <Controller
              name="name"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="link-name">Name (optional)</FieldLabel>
                  <Input {...field} id="link-name" placeholder="Defaults to the site name" />
                </Field>
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Add link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
