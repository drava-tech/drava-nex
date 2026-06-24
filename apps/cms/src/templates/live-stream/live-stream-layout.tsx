import React from "react";
import type { Experience } from "@platform/db";
import { ScreenStage } from "@platform/ui/templates/portfolio";
import { LiveStreamCanvas, readLiveStreamContent } from "@platform/ui/templates/live-stream";

/**
 * Live Stream template — a single 1920×1080 canvas that plays the experience's
 * assigned stream. Used by the CMS edit/preview routes. The full editor (with the
 * stream-id form + connection instructions) is the Workspace in editor-workspace.tsx.
 */
export function LiveStreamLayout({
  experience,
  mode = "edit",
}: {
  experience: Experience;
  subpath: string[];
  mode?: "edit" | "preview";
}) {
  const content = readLiveStreamContent(experience.templateContent) ?? undefined;
  const inner = (
    <div style={{ width: 1920, height: 1080 }}>
      <LiveStreamCanvas streamId={content?.streamId ?? ""} fit={content?.fit} label={content?.label} />
    </div>
  );

  if (mode === "preview") {
    return <ScreenStage variant="fit-screen">{inner}</ScreenStage>;
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <span className="text-[10px] font-bold text-violet-500 tracking-[0.25em] uppercase">
        Live Stream
      </span>
      <ScreenStage>{inner}</ScreenStage>
    </div>
  );
}
