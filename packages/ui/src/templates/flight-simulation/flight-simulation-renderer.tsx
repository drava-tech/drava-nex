"use client";

import {
  DEFAULT_FLIGHT_SIMULATION_CONTENT,
  type FlightSimulationContent,
} from "./content";
import { FlightSimulationCanvas } from "./flight-simulation-canvas";
import { useFlightData } from "./use-flight-data";

/**
 * Renders a Flight Simulation experience full-bleed. Used by both the CMS
 * preview/editor and the live display, so what an operator approves is exactly
 * what a screen shows.
 *
 * There is intentionally no loading or error *screen*: the garden renders
 * immediately on its built-in reference data and swaps in the live flight board
 * when it arrives. A failed or empty feed degrades to locally generated traffic
 * and is reported quietly on the HUD's live dot — a signage display should
 * never show a spinner or a stack trace.
 */
export function FlightSimulationRenderer({
  content,
  /** Disables network polling — used by dev preview and static screenshots. */
  live = true,
}: {
  content?: FlightSimulationContent | null;
  live?: boolean;
}) {
  const config = content ?? DEFAULT_FLIGHT_SIMULATION_CONTENT;

  const { catalog, flights, state } = useFlightData({
    airportCode: config.airportCode,
    refreshIntervalSeconds: live ? config.refreshIntervalSeconds : 0,
  });

  return (
    <FlightSimulationCanvas
      airportCode={config.airportCode}
      label={config.label}
      showHud={config.showHud}
      allowAirportSwitching={config.allowAirportSwitching}
      simulationSpeed={config.simulationSpeed}
      catalog={catalog}
      flights={flights}
      feedState={state}
    />
  );
}
