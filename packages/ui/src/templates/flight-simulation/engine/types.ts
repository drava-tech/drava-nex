// Public surface of the Flight Garden engine. The engine's internals stay
// loosely typed (it is ported imperative WebGL code); everything that crosses
// the React boundary is typed here.

import type { FlightCatalog, FlightRecord } from "@platform/types";

export type { FlightCatalog, FlightRecord };

export interface FlightGardenOptions {
  /**
   * Base URL that asset filenames are resolved against. Must end with "/".
   * Defaults to the CMS static-media path for this template.
   */
  assetBaseUrl?: string;
  /**
   * Origin of the Hono API, for the scene feeds the engine fetches itself —
   * the weather and attendance readings, and the presigned garden video.
   * Same-origin (empty) by default, which is correct wherever nginx routes
   * /api to the backend. No trailing slash required.
   */
  apiBaseUrl?: string;
  /** Airport code to open on. Falls back to the first catalog entry. */
  airportCode?: string;
  /** Overrides the HUD tower title. Empty/omitted = use the airport's own name. */
  label?: string;
  /** Render the glass HUD panels. Default true. */
  showHud?: boolean;
  /** Show the airport picker in the HUD. Default true. */
  allowAirportSwitching?: boolean;
  /** Multiplies each airport's traffic intensity. Default 1. */
  simulationSpeed?: number;
  /**
   * Skip the cinematic intro and damp continuous motion. Defaults to the
   * viewer's `prefers-reduced-motion` setting when omitted.
   */
  reducedMotion?: boolean;
  /**
   * Upper bound on devicePixelRatio. Signage boxes report a high DPR with a
   * weak GPU, where rendering at native 4K tanks the frame rate. Default 2.
   */
  maxPixelRatio?: number;
  /** Airport/airline reference data. Omitted = the engine's built-in tables. */
  catalog?: FlightCatalog | null;
  /** Called when the user picks a different airport in the HUD. */
  onAirportChange?: (code: string) => void;
}

export interface FlightGardenHandle {
  /**
   * Tear down everything: cancels the animation loop, removes listeners,
   * disposes GPU resources and releases the WebGL context. Safe to call more
   * than once.
   */
  dispose: () => void;
  /** Switch airports at runtime (same path the HUD picker uses). */
  setAirport: (code: string) => void;
  /** Replace the reference data after a later/successful catalog fetch. */
  setCatalog: (catalog: FlightCatalog) => void;
  /** Supply a fresh flight board; the sim draws names/routes from it. */
  setRoster: (flights: FlightRecord[]) => void;
  /** Reflects feed health on the HUD's live dot. */
  setFeedState: (state: "connecting" | "live" | "simulated") => void;
}
