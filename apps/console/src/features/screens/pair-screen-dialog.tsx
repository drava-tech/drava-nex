import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2Icon, CopyIcon, RefreshCwIcon } from "lucide-react"
import type { Screen } from "@workspace/types"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { screenKeys, useIssuePairingCode, useScreen } from "./queries"

function useCountdown(until: string | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [until])
  return until ? Math.max(0, Math.floor((Date.parse(until) - now) / 1000)) : 0
}

/**
 * Shows a one-time code for an operator to type on the display. Watches the
 * screen until its `pairedAt` changes, so re-pairing an already-paired screen
 * is detected too.
 */
export function PairScreenDialog({
  screen,
  onOpenChange,
}: {
  screen: Screen | null
  onOpenChange: (open: boolean) => void
}) {
  const issue = useIssuePairingCode()
  const qc = useQueryClient()
  const open = screen !== null
  const pairedAtWhenOpened = useRef<string | null>(null)
  const [done, setDone] = useState(false)

  const code = issue.data
  const secondsLeft = useCountdown(code?.expiresAt)
  const expired = Boolean(code) && secondsLeft === 0

  // Poll only while waiting for the device (the live WebSocket feed replaces this later).
  const watched = useScreen(screen?.id, { refetchInterval: open && !done && !expired ? 2000 : false })

  useEffect(() => {
    if (!screen) return
    pairedAtWhenOpened.current = screen.pairedAt
    setDone(false)
    issue.reset()
    issue.mutate(screen.id)
    // Issue exactly one code per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen?.id])

  useEffect(() => {
    const pairedAt = watched.data?.pairedAt
    if (open && code && pairedAt && pairedAt !== pairedAtWhenOpened.current && !done) {
      setDone(true)
      void qc.invalidateQueries({ queryKey: screenKeys.all })
      toast.success(`“${screen?.name}” is paired`)
    }
  }, [watched.data?.pairedAt, open, code, done, screen?.name, qc])

  const displayUrl = `${window.location.origin}/display`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pair a display with “{screen?.name}”</DialogTitle>
          <DialogDescription>
            On the display, open the address below and type the code.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="pair-success">
            <CheckCircle2Icon className="size-12 text-emerald-600" />
            <p className="font-medium">Paired</p>
            <p className="text-muted-foreground text-sm">The display can now receive content.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex gap-2">
              <Input readOnly value={displayUrl} aria-label="Display address" className="font-mono" />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy address"
                onClick={() => void navigator.clipboard?.writeText(displayUrl).then(() => toast.success("Copied"))}
              >
                <CopyIcon />
              </Button>
            </div>
            <div className="bg-muted flex flex-col items-center gap-2 rounded-lg py-6">
              {issue.isError ? (
                <p className="text-destructive text-sm">{issue.error.message}</p>
              ) : (
                <p
                  className="font-mono text-5xl font-semibold tracking-[0.3em] tabular-nums"
                  data-testid="pairing-code"
                  aria-live="polite"
                >
                  {code?.code ?? "······"}
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                {!code
                  ? "Generating…"
                  : expired
                    ? "This code has expired."
                    : `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")} · waiting for the display…`}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {!done && (
            <Button
              variant="outline"
              disabled={issue.isPending || !screen}
              onClick={() => screen && issue.mutate(screen.id)}
            >
              <RefreshCwIcon />
              New code
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>{done ? "Done" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
