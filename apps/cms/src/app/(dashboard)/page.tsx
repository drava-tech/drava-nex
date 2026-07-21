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
import { LiquidPill, LiquidShine } from "@/app/(dashboard)/_components/dashboard/liquid-pill";
import { RefreshButton } from "@/app/(dashboard)/_components/dashboard/refresh-button";
import { liquidCardGlow } from "@/app/(dashboard)/_components/dashboard/liquid-glass";
import { HeroOverview } from "@/app/(dashboard)/_components/dashboard/hero-overview";
import { TodayUptime } from "@/app/(dashboard)/_components/dashboard/today-uptime";
import { UptimeRing } from "@/app/(dashboard)/_components/dashboard/uptime-ring";
import { UptimeAreaChart } from "@/app/(dashboard)/_components/dashboard/uptime-area-chart";
import { ContentMixDonut } from "@/app/(dashboard)/_components/dashboard/content-mix-donut";
import { ScreensList } from "@/app/(dashboard)/_components/dashboard/screens-table";
import { ActivityFeed } from "@/app/(dashboard)/_components/dashboard/activity-feed";
import { StorageUsage } from "@/app/(dashboard)/_components/dashboard/storage-usage";

// Glass-card treatment shared by every container below — translucent navy
// panel, soft inset highlight, rounded-3xl. Each usage layers its own
// `liquidCardGlow(color)` on top via `style` for a tinted rim + glow that
// matches its content, so the glass reads as colored throughout the page
// rather than flat black with a halo.
const GLASS_CARD =
  "relative rounded-3xl border bg-white/[0.04] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_25px_50px_-25px_rgba(0,0,0,0.85)] backdrop-blur-xl transition-all hover:-translate-y-0.5 overflow-hidden";

export default async function DashboardPage() {
  await requireGuestOrAdmin();

  return (
    // Forces this page into the dark palette (so shared design tokens
    // resolve their dark: variants) and swaps the chart accent colors.
    // The CMS is locked to dark theme globally (see root layout), so this
    // is mostly belt-and-suspenders for the chart color overrides.
    <div
      className="dark relative flex flex-1 flex-col gap-6 p-4 text-foreground md:p-6"
      style={
        {
          "--chart-1": "#38bdf8",
          "--chart-2": "#a78bfa",
          "--chart-3": "#f472b6",
        } as React.CSSProperties
      }
    >
      {/* Ambient glow background — full-bleed behind the whole page, not
          inset as a floating panel. */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[#05070d]" />
        <div className="absolute -left-24 -top-32 h-[520px] w-[520px] rounded-full bg-blue-500/20 blur-[120px]" />
        <div className="absolute -right-24 -bottom-32 h-[520px] w-[520px] rounded-full bg-orange-500/15 blur-[120px]" />
      </div>

      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Dashboard
          </h1>
          <p className="text-sm text-slate-400">
            Overview of your signage network
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiquidPill>Updated just now</LiquidPill>
          <RefreshButton />
        </div>
      </div>

      {/* Bento layout: wider primary column + narrower secondary column,
          each stacking independently — mirrors the reference composition
          (hero/snapshot, ring/ring, list/timeline, chart/grid) while every
          tile still renders the same underlying dashboard data as before. */}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* Primary column */}
        <div className="flex flex-col gap-6">
          <Card className={`${GLASS_CARD} min-h-[240px]`} style={liquidCardGlow("#38bdf8")}>
            <LiquidShine />
            <HeroOverview />
          </Card>

          <Card className={GLASS_CARD} style={liquidCardGlow("#38bdf8")}>
            <LiquidShine />
            <CardHeader>
              <CardTitle className="text-white">Content Mix</CardTitle>
              <CardDescription className="text-slate-400">
                Deployed experiences by type
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ContentMixDonut />
            </CardContent>
          </Card>

          <Card className={GLASS_CARD} style={liquidCardGlow("#a78bfa")}>
            <LiquidShine />
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="text-white">Screens</CardTitle>
                <CardDescription className="text-slate-400">
                  Live status across your network
                </CardDescription>
              </div>
              <LiquidPill accent="blue" href="/screens">View all</LiquidPill>
            </CardHeader>
            <CardContent>
              <ScreensList />
            </CardContent>
          </Card>

          <Card className={GLASS_CARD} style={liquidCardGlow("#38bdf8")}>
            <LiquidShine />
            <CardHeader>
              <CardTitle className="text-white">Screen Uptime</CardTitle>
              <CardDescription className="text-slate-400">
                Share of screens online, last 7 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UptimeAreaChart />
            </CardContent>
          </Card>
        </div>

        {/* Secondary column */}
        <div className="flex flex-col gap-6">
          <Card className={`${GLASS_CARD} min-h-[240px]`} style={liquidCardGlow("#38bdf8")}>
            <LiquidShine />
            <TodayUptime />
          </Card>

          <Card className={GLASS_CARD} style={liquidCardGlow("#a78bfa")}>
            <LiquidShine />
            <CardHeader>
              <CardTitle className="text-white">7-Day Average</CardTitle>
              <CardDescription className="text-slate-400">
                Uptime trend across the network
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UptimeRing />
            </CardContent>
          </Card>

          <Card className={GLASS_CARD} style={liquidCardGlow("#10b981")}>
            <LiquidShine />
            <CardHeader>
              <CardTitle className="text-white">Recent Activity</CardTitle>
              <CardDescription className="text-slate-400">
                Latest changes by your team
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityFeed />
            </CardContent>
          </Card>

          <Card className={GLASS_CARD} style={liquidCardGlow("#cbd5e1")}>
            <LiquidShine />
            <CardHeader>
              <CardTitle className="text-white">Overview</CardTitle>
              <CardDescription className="text-slate-400">
                Key metrics at a glance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <StatCard stat={stats.screens} icon={Monitor} accent="blue" href="/screens" />
                <StatCard stat={stats.experiences} icon={SquareTerminal} accent="violet" href="/experiences" />
                <StatCard stat={stats.media} icon={Film} accent="amber" href="/media" />
                <StatCard stat={stats.users} icon={Users} accent="emerald" href="/users" />
              </div>
            </CardContent>
          </Card>

          <Card className={GLASS_CARD} style={liquidCardGlow("#f59e0b")}>
            <LiquidShine />
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="text-white">Media Library</CardTitle>
                <CardDescription className="text-slate-400">
                  Storage usage and recent uploads
                </CardDescription>
              </div>
              <LiquidPill accent="amber" href="/media">View all</LiquidPill>
            </CardHeader>
            <CardContent>
              <StorageUsage />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
