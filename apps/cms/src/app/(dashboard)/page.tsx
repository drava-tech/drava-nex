import React from "react";
import { Monitor, SquareTerminal, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@platform/ui";
import { listMediaAssets, listScreens } from "@platform/db";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getActiveScreens } from "@/actions/screen-actions";
import { panelBorderStyle } from "@/app/(dashboard)/_components/dashboard/liquid-glass";
import { stats } from "@/app/(dashboard)/_data/dashboard-demo";
import { StatCard } from "@/app/(dashboard)/_components/dashboard/stat-card";
import { UptimeAreaChart } from "@/app/(dashboard)/_components/dashboard/uptime-area-chart";
import { MediaTypeRatio } from "@/app/(dashboard)/_components/dashboard/media-type-ratio";
import { ScreensTable } from "@/app/(dashboard)/_components/dashboard/screens-table";
import { ActivityFeed } from "@/app/(dashboard)/_components/dashboard/activity-feed";
import { StorageUsage } from "@/app/(dashboard)/_components/dashboard/storage-usage";
import { DashboardMediaProvider } from "@/app/(dashboard)/_components/dashboard/media-live-data";
import { MediaAssetsStatCard } from "@/app/(dashboard)/_components/dashboard/media-assets-stat-card";

export default async function DashboardPage() {
  await requireGuestOrAdmin();
  const [screenRows, activeScreenIds, mediaAssets] = await Promise.all([
    listScreens(),
    getActiveScreens(),
    listMediaAssets(),
  ]);

  return (
    <DashboardMediaProvider
      initialAssets={mediaAssets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        sizeBytes: asset.sizeBytes,
        createdAt: asset.createdAt.toISOString(),
      }))}
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
        <span className="text-xs text-muted-foreground">Updated just now</span>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard stat={stats.screens} icon={Monitor} href="/screens" />
        <StatCard stat={stats.experiences} icon={SquareTerminal} href="/experiences" />
        <MediaAssetsStatCard />
        <StatCard stat={stats.users} icon={Users} />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" style={panelBorderStyle("gradient")}>
          <CardHeader>
            <CardTitle>Screen Uptime</CardTitle>
            <CardDescription>Share of screens online, last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <UptimeAreaChart />
          </CardContent>
        </Card>
        <Card style={panelBorderStyle("solid")}>
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
        <Card className="lg:col-span-2" style={panelBorderStyle("solid")}>
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
        <Card style={panelBorderStyle("solid")}>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest changes by your team</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityFeed />
          </CardContent>
        </Card>
      </div>

      {/* Storage row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-3" style={panelBorderStyle("solid")}>
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
