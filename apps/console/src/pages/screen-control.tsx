import { Link, useParams } from "react-router"
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EraserIcon,
  RotateCwIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"
import type { MediaItem } from "@workspace/types"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Label } from "@workspace/ui/components/label"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { Switch } from "@workspace/ui/components/switch"
import { ScreenPlayer } from "@/features/display/player/screen-player"
import { MEDIA_LABELS } from "@/features/media/media-icon"
import { DefaultMediaPicker } from "@/features/screens/default-media-picker"
import { PushPicker } from "@/features/screens/push-picker"
import {
  useNavigateQueue,
  usePushMedia,
  usePushQueue,
  useScreenCommand,
  useScreenDetail,
  useSetBlanked,
  useSetDefaultMedia,
} from "@/features/screens/queries"
import { ScreenStatus } from "@/features/screens/screen-status"
import { useSessionUser } from "@/hooks/use-session-user"
import { timeAgo } from "@/lib/format"

/**
 * Every push answers with how many displays received it. Zero means the change
 * was saved and will show when the display comes back — but nothing changed
 * on any wall right now, and the operator must be told so.
 */
function reportPush(action: string, players: number, screenName: string) {
  if (players > 0) toast.success(action)
  else
    toast.warning(`${action} — but no display is connected`, {
      description: `It will appear when “${screenName}” comes back online.`,
    })
}

function errorToast(err: unknown) {
  toast.error("That didn't work", { description: err instanceof Error ? err.message : undefined })
}

export function ScreenControlPage() {
  const { screenId = "" } = useParams()
  const user = useSessionUser()
  const canOperate = user.role === "ADMIN" || user.role === "OPERATOR"
  const { data: screen, isPending, error } = useScreenDetail(screenId)

  const pushMedia = usePushMedia(screenId)
  const pushQueue = usePushQueue(screenId)
  const navigate = useNavigateQueue(screenId)
  const setDefault = useSetDefaultMedia(screenId)
  const setBlanked = useSetBlanked(screenId)
  const command = useScreenCommand(screenId)
  const busy = pushMedia.isPending || pushQueue.isPending || navigate.isPending

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-destructive text-sm">{error.message}</p>
        <Button asChild variant="outline" className="mt-3 w-fit">
          <Link to="/screens">Back to screens</Link>
        </Button>
      </Card>
    )
  }
  if (isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Skeleton className="aspect-video" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const name = screen.name
  const push = (item: MediaItem) =>
    pushMedia.mutate(item.id, {
      onSuccess: (r) => reportPush(`Showing “${item.name}”`, r.players, name),
      onError: errorToast,
    })
  const inQueue = screen.queue.length > 0

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to screens">
          <Link to="/screens">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-semibold tracking-tight">{name}</h2>
          <p className="text-muted-foreground text-sm">
            {screen.online ? "Connected now" : screen.paired ? `Last seen ${timeAgo(screen.lastSeenAt)}` : "No display paired yet"}
          </p>
        </div>
        <ScreenStatus screen={screen} />
        {canOperate && (
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="blank"
                checked={screen.blanked}
                disabled={setBlanked.isPending}
                onCheckedChange={(on) =>
                  setBlanked.mutate(on, {
                    onSuccess: (r) => reportPush(on ? "Screen stopped" : "Screen resumed", r.players, name),
                    onError: errorToast,
                  })
                }
              />
              <Label htmlFor="blank">Stop screen</Label>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Mute"
              title="Mute"
              onClick={() => command.mutate("MUTE", { onSuccess: (r) => reportPush("Muted", r.players, name), onError: errorToast })}
            >
              <VolumeXIcon />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Unmute"
              title="Unmute"
              onClick={() => command.mutate("UNMUTE", { onSuccess: (r) => reportPush("Unmuted", r.players, name), onError: errorToast })}
            >
              <Volume2Icon />
            </Button>
            <Button
              variant="outline"
              onClick={() => command.mutate("RELOAD", { onSuccess: (r) => reportPush("Display reloading", r.players, name), onError: errorToast })}
            >
              <RotateCwIcon />
              Reload
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="gap-0 overflow-hidden p-0">
          {/* The same player the display runs, silent, fed by the live data. */}
          <div className="relative aspect-video bg-black" data-testid="preview" aria-label="Live preview">
            <ScreenPlayer content={screen.content} blanked={screen.blanked} name={name} preview contained />
          </div>
          <div className="flex items-center gap-2 border-t p-3 text-sm">
            <span className="text-muted-foreground">Now showing:</span>
            <span className="truncate font-medium" data-testid="now-showing">
              {screen.blanked
                ? "Stopped"
                : screen.current
                  ? screen.current.name
                  : screen.default
                    ? `${screen.default.name} (default)`
                    : "Nothing"}
            </span>
          </div>
        </Card>

        <div className="grid content-start gap-4">
          {inQueue && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Queue</CardTitle>
                <CardDescription>
                  Item {screen.queueIndex + 1} of {screen.queue.length}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <ol className="grid gap-1 text-sm">
                  {screen.queue.map((item, i) => (
                    <li
                      key={`${item.id}-${i}`}
                      className={i === screen.queueIndex ? "font-medium" : "text-muted-foreground"}
                      aria-current={i === screen.queueIndex ? "true" : undefined}
                    >
                      {i + 1}. {item.name}
                    </li>
                  ))}
                </ol>
                {canOperate && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      disabled={busy || screen.queueIndex === 0}
                      onClick={() => navigate.mutate("prev", { onError: errorToast })}
                    >
                      <ChevronLeftIcon />
                      Previous
                    </Button>
                    <Button
                      className="flex-1"
                      disabled={busy || screen.queueIndex >= screen.queue.length - 1}
                      onClick={() => navigate.mutate("next", { onError: errorToast })}
                    >
                      Next
                      <ChevronRightIcon />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">When nothing is pushed</CardTitle>
              <CardDescription>Loops silently on the screen as its resting state.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <DefaultMediaPicker
                value={screen.default}
                disabled={!canOperate || setDefault.isPending}
                onChange={(id) =>
                  setDefault.mutate(id, {
                    onSuccess: () => toast.success(id ? "Default item set" : "Default item removed"),
                    onError: errorToast,
                  })
                }
              />
              {canOperate && (screen.current || inQueue) && (
                <Button
                  variant="outline"
                  onClick={() =>
                    pushMedia.mutate(null, {
                      onSuccess: (r) => reportPush("Cleared", r.players, name),
                      onError: errorToast,
                    })
                  }
                >
                  <EraserIcon />
                  Clear — back to the default
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {canOperate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Push content</CardTitle>
            <CardDescription>
              Pick one item to show it now, or several to play them as a queue.
              {screen.current && ` Currently: ${MEDIA_LABELS[screen.current.type]}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PushPicker
              disabled={busy || !screen.paired}
              onPush={push}
              onPushQueue={(items) =>
                pushQueue.mutate(
                  items.map((i) => i.id),
                  {
                    onSuccess: (r) => reportPush(`Playing a queue of ${items.length}`, r.players, name),
                    onError: errorToast,
                  }
                )
              }
            />
            {!screen.paired && (
              <p className="text-muted-foreground mt-3 text-sm">Pair a display with this screen before pushing to it.</p>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
