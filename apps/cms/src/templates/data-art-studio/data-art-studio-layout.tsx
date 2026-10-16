import type { Experience } from "@platform/db";
import {
  DEFAULT_DATA_ART_STUDIO_CONTENT,
  DataArtStudioRenderer,
  readDataArtStudioContent,
} from "@platform/ui/templates/data-art-studio";

/**
 * Data Art Studio template — the standalone Data Art Studio (VelocityMap
 * studio, Flight Garden, World Clock) served from /data-art-studio/.
 *
 * Like Flight Simulation this skips ScreenStage: the studio's pages fit their
 * WebGL canvases to the viewport themselves, so CSS-scaling a fixed 1920x1080
 * surface would only render them at the wrong resolution.
 */
export function DataArtStudioLayout({
  experience,
}: {
  experience: Experience;
  subpath: string[];
  mode?: "edit" | "preview";
}) {
  const content =
    readDataArtStudioContent(experience.templateContent) ?? DEFAULT_DATA_ART_STUDIO_CONTENT;

  return (
    <div className="h-full w-full bg-[#05070a]">
      <DataArtStudioRenderer content={content} />
    </div>
  );
}
