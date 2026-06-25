import React from "react";
import { Film, Monitor, SquareTerminal, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@platform/ui";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { stats } from "@/app/(dashboard)/_data/dashboard-demo";
import { StatCard } from "@/app/(dashboard)/_components/dashboard/stat-card";
import { UptimeAreaChart } from "@/app/(dashboard)/_components/dashboard/uptime-area-chart";
import { ContentMixDonut } from "@/app/(dashboard)/_components/dashboard/content-mix-donut";
import { ScreensTable } from "@/app/(dashboard)/_components/dashboard/screens-table";
import { ActivityFeed } from "@/app/(dashboard)/_components/dashboard/activity-feed";
import { StorageUsage } from "@/app/(dashboard)/_components/dashboard/storage-usage";

export default async function DashboardPage() {
  await requireGuestOrAdmin();

  return (
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
        <StatCard stat={stats.screens} icon={Monitor} />
        <StatCard stat={stats.experiences} icon={SquareTerminal} />
        <StatCard stat={stats.media} icon={Film} />
        <StatCard stat={stats.users} icon={Users} />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Screen Uptime</CardTitle>
            <CardDescription>Share of screens online, last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <UptimeAreaChart />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Content Mix</CardTitle>
            <CardDescription>Deployed experiences by type</CardDescription>
          </CardHeader>
          <CardContent>
            <ContentMixDonut />
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
            <ScreensTable />
          </CardContent>
        </Card>
        <Card>
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
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Media Library</CardTitle>
            <CardDescription>Storage usage and recent uploads</CardDescription>
          </CardHeader>
          <CardContent>
            <StorageUsage />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
