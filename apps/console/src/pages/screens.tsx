import { useState } from "react"
import { Link } from "react-router"
import { LinkIcon, MonitorIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon, UnlinkIcon } from "lucide-react"
import type { Screen } from "@workspace/types"

import { Button } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { DeleteScreenDialog } from "@/features/screens/delete-screen-dialog"
import { PairScreenDialog } from "@/features/screens/pair-screen-dialog"
import { useScreens } from "@/features/screens/queries"
import { ScreenFormDialog } from "@/features/screens/screen-form-dialog"
import { ScreenStatus } from "@/features/screens/screen-status"
import { UnpairScreenDialog } from "@/features/screens/unpair-screen-dialog"
import { useSessionUser } from "@/hooks/use-session-user"
import { timeAgo } from "@/lib/format"

export function ScreensPage() {
  const user = useSessionUser()
  const isAdmin = user.role === "ADMIN"
  const { data: screens, isPending, error, refetch } = useScreens()

  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Screen | null>(null)
  const [deleting, setDeleting] = useState<Screen | null>(null)
  const [pairing, setPairing] = useState<Screen | null>(null)
  const [unpairing, setUnpairing] = useState<Screen | null>(null)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Screens</h2>
          <p className="text-muted-foreground text-sm">
            Every display you can push content to.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            Add screen
          </Button>
        )}
      </div>

      {error ? (
        <Card className="p-6">
          <p className="text-destructive text-sm">Could not load screens: {error.message}</p>
          <Button variant="outline" className="mt-3 w-fit" onClick={() => void refetch()}>
            Try again
          </Button>
        </Card>
      ) : isPending ? (
        <Card className="gap-0 p-0">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b p-4 last:border-b-0">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
          ))}
        </Card>
      ) : screens.length === 0 ? (
        <Card>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MonitorIcon />
              </EmptyMedia>
              <EmptyTitle>No screens yet</EmptyTitle>
              <EmptyDescription>
                {isAdmin
                  ? "Add a screen, then pair a display to it with a one-time code."
                  : "An admin needs to add and pair a screen first."}
              </EmptyDescription>
            </EmptyHeader>
            {isAdmin && (
              <EmptyContent>
                <Button onClick={() => setCreating(true)}>
                  <PlusIcon />
                  Add screen
                </Button>
              </EmptyContent>
            )}
          </Empty>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Last seen</TableHead>
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {screens.map((screen) => (
                <TableRow key={screen.id}>
                  <TableCell className="pl-4 font-medium">
                    <Link to={`/screens/${screen.id}`} className="hover:underline underline-offset-4">
                      {screen.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ScreenStatus screen={screen} />
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell">
                    {screen.online ? "Now" : timeAgo(screen.lastSeenAt)}
                  </TableCell>
                  <TableCell className="pr-4">
                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${screen.name}`}>
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setPairing(screen)}>
                            <LinkIcon />
                            {screen.paired ? "Pair a new display" : "Pair display"}
                          </DropdownMenuItem>
                          {screen.paired && (
                            <DropdownMenuItem onSelect={() => setUnpairing(screen)}>
                              <UnlinkIcon />
                              Unpair
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => setRenaming(screen)}>
                            <PencilIcon />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(screen)}>
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ScreenFormDialog open={creating} onOpenChange={setCreating} />
      <ScreenFormDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        screen={renaming ?? undefined}
      />
      <DeleteScreenDialog screen={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
      <PairScreenDialog screen={pairing} onOpenChange={(open) => !open && setPairing(null)} />
      <UnpairScreenDialog screen={unpairing} onOpenChange={(open) => !open && setUnpairing(null)} />
    </>
  )
}
