import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { ActivityIcon, ArrowRightIcon, HardDriveIcon, MonitorIcon } from "lucide-react"
import type { Overview, OverviewActivity } from "@workspace/types"

import { Button } from "@workspace/ui/components/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { api } from "@/lib/api"
import { formatBytes, timeAgo } from "@/lib/format"

export const overviewKey = ["overview"] as const

function describe(a: OverviewActivity): string {
  const item = a.mediaName ? `“${a.mediaName}”` : "an item"
  switch (a.action) {
    case "media":
      return `showed ${item}`
    case "queue":
      return `started a queue with ${item}`
    case "navigate":
      return `moved the queue to ${item}`
    case "default":
      return a.mediaName ? `set the default to ${item}` : "removed the default"
    case "clear":
      return "cleared it"
    case "blank":
      return "stopped it"
    case "unblank":
      return "resumed it"
  }
}

function Stat({ title, value, detail, icon: Icon }: { title: string; value: string; detail: string; icon: typeof MonitorIcon }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
        <CardAction>
          <Icon className="text-muted-foreground size-5" />
        </CardAction>
      </CardHeader>
      <CardContent className="text-muted-foreground -mt-2 text-sm">{detail}</CardContent>
    </Card>
  )
}

export function OverviewPage() {
  const { data, isPending, error } = useQuery({ queryKey: overviewKey, queryFn: () => api<Overview>("/api/overview") })

  if (error) return <Card className="p-6 text-sm text-destructive">Could not load the overview: {error.message}</Card>

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Overview</h2>
        <p className="text-muted-foreground text-sm">What is live right now, and what changed recently.</p>
      </div>

      {isPending ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3" data-testid="stats">
          <Stat
            title="Screens online"
            value={`${data.screens.online} / ${data.screens.paired}`}
            detail={
              data.screens.total === data.screens.paired
                ? `${data.screens.total} screen${data.screens.total === 1 ? "" : "s"} in total`
                : `${data.screens.total - data.screens.paired} waiting to be paired`
            }
            icon={MonitorIcon}
          />
          <Stat
            title="Media library"
            value={String(data.media.count)}
            detail={`${formatBytes(data.media.bytes)} in cloud storage`}
            icon={HardDriveIcon}
          />
          <Stat
            title="Last push"
            value={data.recent[0] ? timeAgo(data.recent[0].at) : "—"}
            detail={data.recent[0] ? `to ${data.recent[0].screenName}` : "Nothing pushed yet"}
            icon={ActivityIcon}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
          <CardDescription>Every change to what a screen shows, and who made it.</CardDescription>
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link to="/screens">
                Screens
                <ArrowRightIcon />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-40" />
          ) : data.recent.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Nothing yet. Pair a screen, upload some media, and push it.
            </p>
          ) : (
            <ul className="divide-y" data-testid="activity">
              {data.recent.map((a) => (
                <li key={a.id} className="flex items-baseline gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{a.userName ?? "Someone"}</span>{" "}
                    <span className="text-muted-foreground">{describe(a)} on</span>{" "}
                    <Link to={`/screens/${a.screenId}`} className="font-medium underline-offset-4 hover:underline">
                      {a.screenName}
                    </Link>
                  </span>
                  <time className="text-muted-foreground shrink-0 text-xs" dateTime={a.at}>
                    {timeAgo(a.at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}
