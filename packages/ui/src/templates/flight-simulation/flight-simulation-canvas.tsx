"use client";

import { useEffect, useRef, useState } from "react";
import { useReplayableWindowEvent } from "../../lib/replayable-window-event";
import type {
  FlightGardenHandle,
  FlightGardenOptions,
  FlightGardenView,
} from "./engine/types";
import type { FlightFeedState } from "./use-flight-data";
import type { FlightCatalog, FlightRecord } from "@platform/types";

/**
 * Relayed by the player shell to every client of a screen, so changing the
 * visualization (or the airport, or the weather feed) on a control tablet
 * changes it on the wall too. A plain string like the portfolio's own
 * SET_PORTFOLIO_VIEW — SCREEN_COMMAND carries an open `command`, so the gateway
 * needs no say in it.
 */
const VIEW_COMMAND = "SET_FLIGHT_VIEW";
/** The window event the shell turns an inbound VIEW_COMMAND into. */
const VIEW_EVENT = "flight-set-view";

export interface FlightSimulationCanvasProps extends FlightGardenOptions {
  className?: string;
  /** Live board from the API. null = not loaded; the engine generates its own. */
  flights?: FlightRecord[] | null;
  /** Feed health, surfaced on the HUD's live dot. */
  feedState?: FlightFeedState;
}

/**
 * React shell around the imperative Flight Garden engine.
 *
 * Two things make this safe to drop anywhere in the CMS:
 *
 *  1. The engine is loaded with a dynamic `import()` *inside* the effect, so
 *     neither it nor `three` is ever pulled into the server bundle — the module
 *     touches `document` at import time and would crash SSR.
 *  2. Every mount gets its own engine instance and disposes it on unmount. React
 *     19 Strict Mode double-invokes effects in development, so this runs
 *     mount → dispose → mount on every load; that must leave exactly one WebGL
 *     context alive, which is why the effect ignores a load that resolves after
 *     its own teardown.
 */
export function FlightSimulationCanvas({
  className,
  flights,
  feedState,
  ...engineOptions
}: FlightSimulationCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<FlightGardenHandle | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // Latest options without re-creating the engine: rebooting a WebGL scene on
  // every prop tweak would restart the intro and re-download ~37MB of geometry.
  const optionsRef = useRef(engineOptions);
  optionsRef.current = engineOptions;

  // The engine's HUD is a real control surface, not decoration — whoever works
  // it (the wall itself, or an operator in the CMS mirror) is deciding what
  // this screen shows. Publishing on the same "screen-control" bus the gallery
  // and portfolio use lets LiveScreenPlayer relay it to every other client.
  const onViewChange = useRef((view: FlightGardenView) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("screen-control", { detail: { command: VIEW_COMMAND, value: view } })
    );
  }).current;

  // Latest feed values, so a slow engine chunk can catch up on mount.
  /** Last relayed view, so a slow engine chunk adopts it once it boots. */
  const latestView = useRef<FlightGardenView | null>(null);

  const latest = useRef<{
    catalog?: FlightCatalog | null;
    flights?: FlightRecord[] | null;
    feedState?: FlightFeedState;
  }>({});
  latest.current = { catalog: engineOptions.catalog, flights, feedState };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;

    void (async () => {
      try {
        // ".js" is correct here: the engine really is a JavaScript file (see
        // the header in flight-garden.js), so this resolves for both
        // TypeScript's NodeNext rules and webpack.
        const { createFlightGarden } = await import("./engine/flight-garden.js");
        // Unmounted (or Strict Mode re-ran) while the chunk was loading.
        if (cancelled) return;

        const handle = createFlightGarden(host, { ...optionsRef.current, onViewChange });
        handleRef.current = handle;

        // Anything that arrived while the chunk was downloading would otherwise
        // be missed — the effects below only fire on subsequent changes.
        if (latest.current.catalog) handle.setCatalog(latest.current.catalog);
        if (latest.current.flights) handle.setRoster(latest.current.flights);
        if (latest.current.feedState) handle.setFeedState(latest.current.feedState);
        if (latestView.current) handle.setView(latestView.current);
      } catch (err) {
        if (cancelled) return;
        console.error("[Flight Garden] failed to start:", err);
        setFailed(err instanceof Error ? err.message : "Failed to start the simulation.");
      }
    })();

    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
    // Deliberately empty: the engine is booted once per mount and updated
    // through its handle (see the effects below), never re-created on prop
    // changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Airport changes are applied imperatively — the engine cross-fades rather
  // than rebuilding the scene.
  useEffect(() => {
    if (engineOptions.airportCode) handleRef.current?.setAirport(engineOptions.airportCode);
  }, [engineOptions.airportCode]);

  useEffect(() => {
    if (engineOptions.catalog) handleRef.current?.setCatalog(engineOptions.catalog);
  }, [engineOptions.catalog]);

  useEffect(() => {
    if (flights) handleRef.current?.setRoster(flights);
  }, [flights]);

  useEffect(() => {
    if (feedState) handleRef.current?.setFeedState(feedState);
  }, [feedState]);

  // Authored chrome and pacing are pushed into the running engine too. The
  // engine reads these off the options object it was booted with, so without
  // this a CMS edit only showed up after the display happened to reload — the
  // screen kept the HUD, label and speed it started with.
  useEffect(() => {
    handleRef.current?.setOptions({
      label: engineOptions.label,
      showHud: engineOptions.showHud,
      allowAirportSwitching: engineOptions.allowAirportSwitching,
      simulationSpeed: engineOptions.simulationSpeed,
    });
  }, [
    engineOptions.label,
    engineOptions.showHud,
    engineOptions.allowAirportSwitching,
    engineOptions.simulationSpeed,
  ]);

  // Inbound view from another client of this screen (or the gateway replaying
  // the last one after a reconnect/re-push). Replayable because that replay
  // lands right after WELCOME, long before the engine chunk has finished
  // loading — see replayable-window-event.ts.
  useReplayableWindowEvent<FlightGardenView | undefined>(VIEW_EVENT, (view) => {
    if (view) {
      latestView.current = view;
      handleRef.current?.setView(view);
    }
  });

  if (failed) {
    return (
      <div
        className={className}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#05070a",
          color: "rgba(233,239,243,0.52)",
          font: "500 13px/1.5 system-ui, sans-serif",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        Flight Garden could not start on this display.
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: "100%", height: "100%", background: "#05070a" }}
    />
  );
}
