// Content shape for the Flight Simulation template ("Flight Garden" — an airport
// operations visualization rendered as a living garden, butterflies = flights).
// Stored on the experience as experience.templateContent["flight-simulation"].
//
// This holds ONLY presentation config — never flight data. The airport catalog
// and the flight roster are fetched from the API at render time
// (/api/flight-simulation/*), so a screen always shows the current board and a
// real data provider can be swapped in later without re-authoring experiences.
// Shared by the CMS (editor + preview) and the display renderer.

export interface FlightSimulationContent {
  /** ICAO/IATA code of the airport the garden opens on (e.g. "BLR"). */
  airportCode: string;
  /** Overrides the HUD tower title. Empty = use the catalog's tower name. */
  label: string;
  /** Show the glass HUD (tower, stats, legend, flight detail). Off = ambient wall. */
  showHud: boolean;
  /** Show the airport picker in the HUD. Off for non-interactive screens. */
  allowAirportSwitching: boolean;
  /**
   * Multiplies the airport's traffic intensity (0.5 = calm, 2 = busy).
   * Flight count itself is gate-derived, so this is the safe pacing control.
   */
  simulationSpeed: number;
  /** How often to re-fetch the flight roster. 0 disables polling. */
  refreshIntervalSeconds: number;
}

export const DEFAULT_FLIGHT_SIMULATION_CONTENT: FlightSimulationContent = {
  airportCode: "BLR",
  label: "",
  showHud: true,
  allowAirportSwitching: true,
  simulationSpeed: 1,
  refreshIntervalSeconds: 60,
};

/** Clamp helper — a bad stored value must never reach the render loop. */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Reads the flight-simulation content slice off an experience row, or null if
 * unset. Tolerates partial/legacy slices by merging over the defaults, and
 * coerces the numeric fields so a hand-edited value can't break the engine.
 */
export function readFlightSimulationContent(
  templateContent: Record<string, unknown> | null | undefined
): FlightSimulationContent | null {
  const slice = templateContent?.["flight-simulation"];
  if (!slice || typeof slice !== "object") return null;

  const merged = {
    ...DEFAULT_FLIGHT_SIMULATION_CONTENT,
    ...(slice as Partial<FlightSimulationContent>),
  };

  return {
    ...merged,
    airportCode:
      typeof merged.airportCode === "string" && merged.airportCode.trim()
        ? merged.airportCode.trim().toUpperCase()
        : DEFAULT_FLIGHT_SIMULATION_CONTENT.airportCode,
    label: typeof merged.label === "string" ? merged.label : "",
    showHud: merged.showHud !== false,
    allowAirportSwitching: merged.allowAirportSwitching !== false,
    simulationSpeed: clampNumber(merged.simulationSpeed, 0.5, 2, 1),
    refreshIntervalSeconds: clampNumber(merged.refreshIntervalSeconds, 0, 3600, 60),
  };
}
