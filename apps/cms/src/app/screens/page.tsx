import React from "react";
import Link from "next/link";
import { Monitor, PlusCircle, Tv2, Trash2 } from "lucide-react";
import { readScreensJson, readContentsJson } from "../../lib/config-writer";

export const dynamic = "force-dynamic";
import { assignContent, addScreen, removeScreen } from "../../actions/screen-actions";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Badge,
  cn,
} from "@platform/ui";

export default async function ScreensPage() {
  const [screensData, contentsData] = await Promise.all([
    readScreensJson(),
    readContentsJson(),
  ]);

  const screens = screensData.screens || [];
  const contents = contentsData.contents || [];

  async function handleAssign(formData: FormData) {
    "use server";
    const screenId = formData.get("screenId") as string;
    const contentId = formData.get("contentId") as string;
    if (screenId && contentId) await assignContent(screenId, contentId);
  }

  async function handleAdd(formData: FormData) {
    "use server";
    const screenId = formData.get("screenId") as string;
    const screenName = formData.get("screenName") as string;
    const contentId = formData.get("contentId") as string;
    if (screenId && screenName && contentId) {
      try {
        await addScreen(screenId, screenName, contentId);
      } catch (err) {
        console.error(err);
      }
    }
  }

  async function handleDelete(formData: FormData) {
    "use server";
    const screenId = formData.get("screenId") as string;
    if (screenId) await removeScreen(screenId);
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

  const selectClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Nav */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-primary">
              CMS Control Center
            </span>
            <h1 className="mt-0.5 text-2xl font-bold text-foreground">
              Screen Management
            </h1>
          </div>
          <nav className="flex gap-1">
            <Link
              href="/"
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Dashboard
            </Link>
            <Link
              href="/screens"
              className="rounded-md bg-secondary px-3 py-2 text-sm font-semibold text-foreground"
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

      {/* Main Content */}
      <main className="mx-auto grid max-w-6xl grid-cols-[1fr_320px] gap-8 px-6 py-8">

        {/* Screen List */}
        <section className="flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <Tv2 className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">
              Active Screens
            </h2>
            <Badge variant="secondary" className="ml-1 tabular-nums">
              {screens.length}
            </Badge>
          </div>

          <div className="flex flex-col gap-4">
            {screens.map((screen: any) => {
              const currentContent = contents.find(
                (c: any) => c.id === screen.contentId
              );
              return (
                <Card key={screen.screenId} className="bg-card">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Monitor className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-base">
                            {screen.screenName}
                          </CardTitle>
                          <span className="font-mono text-xs text-muted-foreground">
                            {screen.screenId}
                          </span>
                        </div>
                      </div>
                      <form action={handleDelete}>
                        <input
                          type="hidden"
                          name="screenId"
                          value={screen.screenId}
                        />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </form>
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-3 pt-0">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>Assigned:</span>
                      <span className="font-semibold text-primary">
                        {screen.contentId}
                      </span>
                      {currentContent && (
                        <Badge variant="outline" className="text-[10px]">
                          {currentContent.type}
                        </Badge>
                      )}
                    </div>

                    <form
                      action={handleAssign}
                      className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
                    >
                      <input
                        type="hidden"
                        name="screenId"
                        value={screen.screenId}
                      />
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Change to:
                      </span>
                      <select
                        name="contentId"
                        defaultValue={screen.contentId}
                        className={cn(selectClass, "bg-muted/50")}
                      >
                        {contents.map((content: any) => (
                          <option key={content.id} value={content.id}>
                            {content.id} ({content.type})
                          </option>
                        ))}
                      </select>
                      <Button type="submit" size="sm" className="shrink-0">
                        Update
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              );
            })}

            {screens.length === 0 && (
              <Card className="bg-card">
                <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Tv2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    No screens configured yet. Register your first display using
                    the form.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </section>

        {/* Sidebar: Add Screen */}
        <aside>
          <Card className="sticky top-8 bg-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <PlusCircle className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Add New Screen</CardTitle>
              </div>
              <CardDescription>
                Register a display device to this CMS
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                action={handleAdd}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Screen ID
                  </label>
                  <input
                    type="text"
                    name="screenId"
                    placeholder="e.g. tv-03"
                    required
                    className={inputClass}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Screen Name
                  </label>
                  <input
                    type="text"
                    name="screenName"
                    placeholder="e.g. Lounge Wall TV"
                    required
                    className={inputClass}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Default Content
                  </label>
                  <select name="contentId" required className={selectClass}>
                    {contents.map((content: any) => (
                      <option key={content.id} value={content.id}>
                        {content.id} ({content.type})
                      </option>
                    ))}
                  </select>
                </div>

                <Button type="submit" className="mt-1 w-full">
                  Register Screen
                </Button>
              </form>
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}
