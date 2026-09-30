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
import { ScreensTable } from "@/app/(dashboard)/_components/dashboard/screens-table";
import { ActivityFeed } from "@/app/(dashboard)/_components/dashboard/activity-feed";
import { StorageUsage } from "@/app/(dashboard)/_components/dashboard/storage-usage";
import { DashboardMediaProvider } from "@/app/(dashboard)/_components/dashboard/media-live-data";
import { MediaAssetsStatCard } from "@/app/(dashboard)/_components/dashboard/media-assets-stat-card";
import { sampleUptimeSeries } from "@/app/(dashboard)/_components/dashboard/sample-data";
import { SampleBadge } from "@/app/(dashboard)/_components/dashboard/sample-badge";

/** Sampling interval of apps/api/src/services/screen-uptime.ts, in minutes —
 * used only to tell a fully-recorded day from a partial one on the chart. */
const UPTIME_SAMPLE_MINUTES = 5;

/** Turn a template key into something readable: "live-stream" → "live stream". */
function humanTemplate(key: string): string {
  return key.replace(/[-_]/g, " ");
}

export default async function DashboardPage() {
  await requireGuestOrAdmin();
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
    getCachedMediaLibraryStats(),
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
    .map((r) => `${r.count} ${r.role.toLowerCase()}`)
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
      <div className="flex flex-1 flex-col gap-4 p-4">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Overview of your signage network
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            label: "Experiences",
            value: String(experienceStats.total),
            breakdown: topTemplates || undefined,
          }}
          icon={SquareTerminal}
          href="/experiences"
        />
        <MediaAssetsStatCard />
        <StatCard
          stat={{
            label: "Active Users",
            value: String(userStats.activeNow),
            breakdown: `${userStats.total} total · ${roleBreakdown}`,
          }}
          icon={Users}
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
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
        <Card>
          <CardHeader>
            <CardTitle>Media Ratio</CardTitle>
            <CardDescription>Videos, images, and documents</CardDescription>
          </CardHeader>
          <CardContent>
            <MediaTypeRatio />
          </CardContent>
        </Card>
      </div>

      {/* Operations row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Screens</CardTitle>
            <CardDescription>Live status across your network</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <ScreensTable
              initialScreens={screenRows}
              initialActiveScreenIds={activeScreenIds}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest pushes and uploads</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityFeed items={activity} />
          </CardContent>
        </Card>
      </div>

      {/* Storage row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Media Library</CardTitle>
            <CardDescription>Live storage totals and recent uploads</CardDescription>
          </CardHeader>
          <CardContent>
            <StorageUsage />
          </CardContent>
        </Card>
      </div>
      </div>
    </DashboardMediaProvider>
  );
}
