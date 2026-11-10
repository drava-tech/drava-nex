import type { Experience } from "@platform/db";
import { DravaWorldRenderer } from "@platform/ui/templates/drava-world";

/**
 * Drava World template — the standalone Drava World (the virtual Experience
 * Centre) served from /drava-world/, exactly as the standalone app shows it.
 *
 * Like Drava Mosaic this skips ScreenStage: the app fits its WebGL canvas to
 * the viewport itself, so CSS-scaling a fixed 1920x1080 surface would only
 * render it at the wrong resolution.
 */
export function DravaWorldLayout(_props: {
  experience: Experience;
  subpath: string[];
  mode?: "edit" | "preview";
}) {
  return (
    <div className="h-full w-full bg-[#07080b]">
      <DravaWorldRenderer />
    </div>
  );
}
