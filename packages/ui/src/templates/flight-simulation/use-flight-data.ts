"use client";

import { useEffect, useRef, useState } from "react";
import type { FlightCatalog, FlightRecord } from "@platform/types";

/**
 * Live data for the Flight Garden, fetched from the Hono API.
 *
 * The governing rule: this is an *enhancement*, never a dependency. The engine
 * boots instantly on its built-in tables and keeps running on locally generated
 * traffic whenever the API is unreachable, slow or empty — an unattended screen
 * must never go blank because a fetch failed. Everything here therefore fails
 * soft and retries quietly.
 */

export type FlightFeedState = "connecting" | "live" | "simulated";

const CATALOG_PATH = "/api/flight-simulation/airports";
const FLIGHTS_PATH = "/api/flight-simulation/flights";

/** Retry backoff for a failing feed, capped so a long outage stays cheap. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

/** Board size — comfortably more than the scene has gates, so it rarely drains. */
const ROSTER_LIMIT = 40;

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !body.success || body.data === undefined) {
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return body.data;
}

export interface UseFlightDataOptions {
  airportCode: string;
  /** Seconds between board refreshes. 0 disables polling entirely. */
  refreshIntervalSeconds: number;
  /**
   * Same-origin by default — nginx routes /api to the Hono backend and Next
   * rewrites it in dev, so a relative path is correct in every environment.
   */
  apiBaseUrl?: string;
}

export interface FlightData {
  catalog: FlightCatalog | null;
  flights: FlightRecord[] | null;
  state: FlightFeedState;
}

export function useFlightData({
  airportCode,
  refreshIntervalSeconds,
  apiBaseUrl = "",
}: UseFlightDataOptions): FlightData {
  const [catalog, setCatalog] = useState<FlightCatalog | null>(null);
  const [flights, setFlights] = useState<FlightRecord[] | null>(null);
  const [state, setState] = useState<FlightFeedState>("connecting");

  // Consecutive failures, for backoff. A ref so retrying doesn't re-render.
  const failures = useRef(0);

  // The catalog is authored reference data: fetch once, never poll.
  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const data = await fetchJson<FlightCatalog>(
          `${apiBaseUrl}${CATALOG_PATH}`,
          controller.signal
        );
        setCatalog(data);
      } catch (err) {
        if (controller.signal.aborted) return;
        // Not fatal — the engine keeps its built-in airport/airline tables.
        console.warn("[Flight Garden] airport catalog unavailable:", err);
      }
    })();

    return () => controller.abort();
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!airportCode) return;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const load = async () => {
      try {
        const url = `${apiBaseUrl}${FLIGHTS_PATH}?airport=${encodeURIComponent(airportCode)}&limit=${ROSTER_LIMIT}`;
        const data = await fetchJson<{ flights: FlightRecord[] }>(url, controller.signal);
        if (stopped) return;

        failures.current = 0;
        setFlights(data.flights);
        // An empty board is a successful response, but there is nothing to
        // render from — the engine falls back to generated traffic, so report
        // it honestly rather than claiming a live feed.
        setState(data.flights.length ? "live" : "simulated");
      } catch (err) {
        if (stopped || controller.signal.aborted) return;
        failures.current += 1;
        setState("simulated");
        console.warn("[Flight Garden] flight board unavailable:", err);
      } finally {
        if (stopped) return;

        // Reschedule: the normal interval on success, capped backoff on
        // failure. Polling stays on even when disabled by config if we are
        // currently failing, so the feed can recover on its own.
        const failing = failures.current > 0;
        const backoff = Math.min(RETRY_BASE_MS * 2 ** (failures.current - 1), RETRY_MAX_MS);
        const delay = failing ? backoff : refreshIntervalSeconds * 1000;

        if (delay > 0) timer = setTimeout(load, delay);
      }
    };

    void load();

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [airportCode, refreshIntervalSeconds, apiBaseUrl]);

  return { catalog, flights, state };
}
