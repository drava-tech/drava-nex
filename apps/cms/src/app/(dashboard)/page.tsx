import React from "react";
import { Monitor, SquareTerminal, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@platform/ui";
import {
  getMediaLibraryStats,
  listScreens,
  UPTIME_WINDOW,
  UPTIME_TIME_ZONE,
} from "@platform/db";
import {
  getCachedMediaLibraryStats,
  getCachedDailyScreenUptime,
  getCachedScreenUptimeRecordingSince,
  getCachedRecentActivity,
  getCachedExperienceStats,
  getCachedUserStats,
} from "@/lib/dashboard-cache";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getActiveScreens } from "@/actions/screen-actions";
import { StatCard } from "@/app/(dashboard)/_components/dashboard/stat-card";
import { UptimeAreaChart } from "@/app/(dashboard)/_components/dashboard/uptime-area-chart";
import { MediaTypeRatio } from "@/app/(dashboard)/_components/dashboard/media-type-ratio";
import { ActivityFeed } from "@/app/(dashboard)/_components/dashboard/activity-feed";
import { DashboardMediaProvider } from "@/app/(dashboard)/_components/dashboard/media-live-data";
import { MediaAssetsStatCard } from "@/app/(dashboard)/_components/dashboard/media-assets-stat-card";
import { sampleUptimeSeries } from "@/app/(dashboard)/_components/dashboard/sample-data";
import { SampleBadge } from "@/app/(dashboard)/_components/dashboard/sample-badge";
import { roleLabel } from "@/lib/roles";

/** Sampling interval of apps/api/src/services/screen-uptime.ts, in minutes —
 * used only to tell a fully-recorded day from a partial one on the chart. */
const UPTIME_SAMPLE_MINUTES = 5;

/** Turn a template key into something readable: "live-stream" → "live stream". */
function humanTemplate(key: string): string {
  return key.replace(/[-_]/g, " ");
}

export default async function DashboardPage() {
  const viewer = await requireGuestOrAdmin();
  // A User sees only their own media (as on the Media page), so their media
  // figures are theirs too — and not the shared, library-wide cache.
  const mediaOwner = viewer.role === "GUEST" ? { userId: viewer.id, email: viewer.email } : null;
  const [
    screenRows,
    activeScreenIds,
    mediaStats,
    uptime,
    recordingSince,
    activity,
    experienceStats,
    userStats,
  ] = await Promise.all([
    // Screen rows and live-connection state stay uncached — that is what the
    // operator acts on. Everything below them is analytics on a 20s TTL; see
    // lib/dashboard-cache.ts.
    listScreens(),
    getActiveScreens(),
    mediaOwner ? getMediaLibraryStats({}, 4, mediaOwner) : getCachedMediaLibraryStats(),
    getCachedDailyScreenUptime(),
    getCachedScreenUptimeRecordingSince(),
    getCachedRecentActivity(),
    getCachedExperienceStats(),
    getCachedUserStats(),
  ]);

  const onlineCount = screenRows.filter((s) => activeScreenIds.includes(s.screenId)).length;
  const offlineCount = screenRows.length - onlineCount;

  const topTemplates = experienceStats.byTemplate
    .slice(0, 2)
    .map((t) => `${t.count} ${humanTemplate(t.templateKey)}`)
    .join(" · ");

  const roleBreakdown = userStats.byRole
    .map((r) => `${r.count} ${roleLabel(r.role).toLowerCase()}${r.count === 1 ? "" : "s"}`)
    .join(" · ");

  // Hours per day the window covers, times samples per hour.
  const expectedSamplesPerDay =
    (UPTIME_WINDOW.endHour - UPTIME_WINDOW.startHour) * (60 / UPTIME_SAMPLE_MINUTES);

  // Nothing recorded for any of the seven days yet — recording only started
  // today. Keep the REAL dates and fill placeholder values, so the x-axis is
  // still truthful about which days are being shown.
  const uptimeIsSample = uptime.every((d) => d.value === null);
  const uptimeSeries = uptimeIsSample ? sampleUptimeSeries(uptime) : uptime;

  // instanceof rather than a null check: db.execute() returns timestamps as
  // strings and its type argument is an unchecked assertion, so a regression in
  // that query would otherwise throw here and take the WHOLE dashboard down
  // over one subtitle. Degrade to no label instead.
  const sinceLabel =
    recordingSince instanceof Date && !Number.isNaN(recordingSince.getTime())
      ? recordingSince.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          timeZone: UPTIME_TIME_ZONE,
        })
      : null;

  return (
    <DashboardMediaProvider
      initialStats={{
        total: mediaStats.total,
        totalBytes: mediaStats.totalBytes,
        byType: mediaStats.byType,
        recentCount: mediaStats.recentCount,
        recent: mediaStats.recent.map((asset) => ({
          id: asset.id,
          name: asset.name,
          type: asset.type,
          sizeBytes: asset.sizeBytes,
          createdAt: asset.createdAt.toISOString(),
        })),
      }}
    >
      {/* @container: the columns follow the width this page actually has, not
          the window. With the sidebar open a tablet reports a desktop-sized
          window but leaves the page far less, which squeezed the side column. */}
      <div className="@container flex flex-1 flex-col gap-4 p-4">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          stat={{
            label: "Total Screens",
            value: String(screenRows.length),
            breakdown: `${onlineCount} online · ${offlineCount} offline`,
          }}
          icon={Monitor}
          href="/screens"
        />
        <StatCard
          stat={{
            label: "Portfolio",
            value: String(experienceStats.total),
            breakdown: topTemplates || undefined,
          }}
          icon={SquareTerminal}
          href="/experiences"
        />
        <MediaAssetsStatCard />
        <StatCard
          stat={{
            label: "Users",
            value: String(userStats.total),
            breakdown: roleBreakdown,
          }}
          icon={Users}
          highlight
          // Only the super admin manages people, so only they get the way in.
          href={viewer.role === "SUPERADMIN" ? "/settings#users" : undefined}
        />
      </div>

      {/* Charts + operations: two independent columns so each card is its
          natural height and the one below flows straight on from it. */}
      <div className="grid grid-cols-1 gap-4 @6xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 @6xl:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Screen Uptime</CardTitle>
                {uptimeIsSample && <SampleBadge title="No uptime recorded yet — these values are placeholders" />}
              </div>
              <CardDescription>
                {/* Says what it actually measures. A 24-hour denominator would
                    read ~40% forever, since the screens are off overnight. */}
                Share of screens online during office hours, last 7 days
                {sinceLabel && ` · recording since ${sinceLabel}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UptimeAreaChart
                series={uptimeSeries}
                expectedSamplesPerDay={expectedSamplesPerDay}
                isSample={uptimeIsSample}
              />
            </CardContent>
          </Card>
        </div>
        {/* Side column on wide pages; below that the two cards sit side by
            side under the chart, then stack on narrow ones. */}
        <div className="grid min-w-0 grid-cols-1 gap-4 @2xl:grid-cols-2 @6xl:flex @6xl:flex-col">
          <Card>
            <CardHeader>
              <CardTitle>Media Ratio</CardTitle>
              <CardDescription>Videos, images, and documents</CardDescription>
            </CardHeader>
            <CardContent>
              <MediaTypeRatio />
            </CardContent>
          </Card>
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest pushes and uploads</CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityFeed items={activity} />
            </CardContent>
          </Card>
        </div>
      </div>

      </div>
    </DashboardMediaProvider>
  );
}
