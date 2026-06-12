import React from "react";
import Link from "next/link";
import { Monitor, Film, Zap, ExternalLink } from "lucide-react";
import { readScreensJson, readContentsJson } from "../lib/config-writer";

export const dynamic = "force-dynamic";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
} from "@platform/ui";

export default async function DashboardPage() {
  const [screensData, contentsData] = await Promise.all([
    readScreensJson(),
    readContentsJson(),
  ]);

  const screens = screensData.screens || [];
  const contents = contentsData.contents || [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Nav */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-primary">
              CMS Platform
            </span>
            <h1 className="mt-0.5 text-2xl font-bold text-foreground">
              Control Center
            </h1>
          </div>
          <nav className="flex gap-1">
            <Link
              href="/"
              className="rounded-md bg-secondary px-3 py-2 text-sm font-semibold text-foreground"
            >
              Dashboard
            </Link>
            <Link
              href="/screens"
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Screens
            </Link>
            <Link
              href="/contents"
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Content Library
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Hero */}
        <div className="mb-8">
          <p className="text-sm text-muted-foreground">
            Real-time dynamic configuration for digital signage displays.
          </p>
        </div>

        {/* Stat Cards */}
        <div className="mb-8 grid grid-cols-3 gap-4">
          <Link href="/screens" className="group">
            <Card className="bg-card transition-colors group-hover:border-primary/40">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs font-semibold uppercase tracking-wider">
                    Monitored Screens
                  </CardDescription>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <Monitor className="h-4 w-4 text-primary" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">
                  {screens.length}
                </div>
                <p className="mt-1 text-xs font-medium text-primary">
                  Configure active screens →
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/contents" className="group">
            <Card className="bg-card transition-colors group-hover:border-primary/40">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs font-semibold uppercase tracking-wider">
                    Content Assets
                  </CardDescription>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                    <Film className="h-4 w-4 text-emerald-500" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">
                  {contents.length}
                </div>
                <p className="mt-1 text-xs font-medium text-emerald-500">
                  Manage video library →
                </p>
              </CardContent>
            </Card>
          </Link>

          <Card className="border-dashed border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <CardDescription className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Zero-Database
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Changes write to JSON instantly. Players reload and resolve
                updates on the fly.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Screen Status Table */}
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-base">Active Screen Status</CardTitle>
            <CardDescription>
              All registered displays and their current content assignment
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_140px_1fr_100px] border-b border-border px-6 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Screen Name</span>
              <span>Screen ID</span>
              <span>Active Content</span>
              <span className="text-right">Portal</span>
            </div>

            {screens.map((screen: any) => (
              <div
                key={screen.screenId}
                className="grid grid-cols-[1fr_140px_1fr_100px] items-center border-b border-border px-6 py-4 text-sm last:border-0 hover:bg-muted/20 transition-colors"
              >
                <span className="font-semibold text-foreground">
                  {screen.screenName}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {screen.screenId}
                </span>
                <span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {screen.contentId}
                  </Badge>
                </span>
                <span className="text-right">
                  <a
                    href={`/screens/${screen.screenId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500 hover:text-emerald-400 transition-colors"
                  >
                    Live
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </span>
              </div>
            ))}

            {screens.length === 0 && (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                No active displays configured.{" "}
                <Link href="/screens" className="text-primary hover:underline">
                  Add a screen to get started.
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
