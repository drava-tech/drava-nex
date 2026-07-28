import type { Experience } from "@platform/db";
import {
  DEFAULT_FLIGHT_SIMULATION_CONTENT,
  FlightSimulationRenderer,
  readFlightSimulationContent,
} from "@platform/ui/templates/flight-simulation";

/**
 * Flight Simulation template — the "Flight Garden" WebGL visualization.
 *
 * Unlike the other templates this does NOT go through ScreenStage. ScreenStage
 * renders a fixed 1920x1080 surface and CSS-scales it, which is right for
 * pixel-authored layouts but wrong here: the scene is resolution-independent
 * and already fits its container via the camera, so scaling it would render at
 * the wrong resolution and blur the result. It fills the container directly and
 * the engine's ResizeObserver adapts the camera instead.
 */
export function FlightSimulationLayout({
  experience,
}: {
  experience: Experience;
  subpath: string[];
  mode?: "edit" | "preview";
}) {
  const content =
    readFlightSimulationContent(experience.templateContent) ??
    DEFAULT_FLIGHT_SIMULATION_CONTENT;

  return (
    <div className="h-full w-full bg-[#05070a]">
      <FlightSimulationRenderer content={content} />
    </div>
  );
}
