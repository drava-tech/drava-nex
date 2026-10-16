import type { Experience } from "@platform/db";
import { DataArtStudioRenderer } from "@platform/ui/templates/data-art-studio";

/**
 * Data Art Studio template — the standalone Data Art Studio (VelocityMap
 * studio, Flight Garden, World Clock) served from /data-art-studio/, exactly
 * as the standalone app shows it.
 *
 * Like Flight Simulation this skips ScreenStage: the studio's pages fit their
 * WebGL canvases to the viewport themselves, so CSS-scaling a fixed 1920x1080
 * surface would only render them at the wrong resolution.
 */
export function DataArtStudioLayout(_props: {
  experience: Experience;
  subpath: string[];
  mode?: "edit" | "preview";
}) {
  return (
    <div className="h-full w-full bg-[#05070a]">
      <DataArtStudioRenderer />
    </div>
  );
}
