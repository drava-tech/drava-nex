import type { Experience } from "@platform/db";
import { DravaMosaicRenderer } from "@platform/ui/templates/drava-mosaic";

/**
 * Drava Mosaic template — the standalone Drava Mosaic (VelocityMap
 * studio, Flight Garden, World Clock) served from /drava-mosaic/, exactly
 * as the standalone app shows it.
 *
 * Like Flight Simulation this skips ScreenStage: the studio's pages fit their
 * WebGL canvases to the viewport themselves, so CSS-scaling a fixed 1920x1080
 * surface would only render them at the wrong resolution.
 */
export function DravaMosaicLayout(_props: {
  experience: Experience;
  subpath: string[];
  mode?: "edit" | "preview";
}) {
  return (
    <div className="h-full w-full bg-[#05070a]">
      <DravaMosaicRenderer />
    </div>
  );
}
