import React from "react";
import { readContentsJson } from "../../../lib/config-writer";

export const dynamic = "force-dynamic";
import { addContent, removeContent } from "../../../actions/content-actions";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
} from "@platform/ui";

export default async function ContentsPage() {
  const contentsData = await readContentsJson();
  const contents = contentsData.contents || [];

  async function handleAdd(formData: FormData) {
    "use server";
    const id = formData.get("id") as string;
    const source = formData.get("source") as string;
    const loop = formData.get("loop") === "on";
    const muted = formData.get("muted") === "on";
    if (id && source) {
      try {
        await addContent(id, source, loop, muted);
      } catch (err) {
        console.error(err);
      }
    }
  }

  async function handleDelete(formData: FormData) {
    "use server";
    const id = formData.get("id") as string;
    if (id) await removeContent(id);
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="text-foreground">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Content Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage video assets assigned to your displays.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_340px] gap-8">
        {/* Content Grid */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Available Assets ({contents.length})
          </h2>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {contents.map((content: any) => (
              <Card key={content.id} className="bg-card flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <CardTitle className="text-base truncate">{content.id}</CardTitle>
                      <Badge variant="default" className="text-[10px] shrink-0">
                        {content.type}
                      </Badge>
                    </div>
                    <form action={handleDelete}>
                      <input type="hidden" name="id" value={content.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                      >
                        Delete
                      </Button>
                    </form>
                  </div>
                  <CardDescription className="truncate text-xs font-mono">
                    {content.source}
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-0">
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${content.loop ? "bg-emerald-500" : "bg-zinc-500"}`}
                      />
                      Loop: {content.loop ? "ON" : "OFF"}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${content.muted ? "bg-emerald-500" : "bg-zinc-500"}`}
                      />
                      Muted: {content.muted ? "ON" : "OFF"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}

            {contents.length === 0 && (
              <Card className="col-span-full bg-card">
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  No content assets registered. Use the panel to add your first video.
                </CardContent>
              </Card>
            )}
          </div>
        </section>

        {/* Add Content Panel */}
        <aside>
          <Card className="sticky top-8 bg-card">
            <CardHeader>
              <CardTitle className="text-base">Add Video Asset</CardTitle>
              <CardDescription>
                Register a video source to the content library
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={handleAdd} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Content ID
                  </label>
                  <input
                    type="text"
                    name="id"
                    placeholder="e.g. promo-video-lobby"
                    required
                    className={inputClass}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Video Source URL
                  </label>
                  <input
                    type="text"
                    name="source"
                    placeholder="e.g. /media/promo.mp4"
                    required
                    className={inputClass}
                  />
                </div>

                <div className="flex flex-col gap-2 mt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="checkbox" name="loop" defaultChecked className="h-4 w-4" />
                    <span>Loop video continuously</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="checkbox" name="muted" defaultChecked className="h-4 w-4" />
                    <span>Mute audio (required for autoplay)</span>
                  </label>
                </div>

                <Button type="submit" className="mt-1 w-full">
                  Add to Library
                </Button>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
