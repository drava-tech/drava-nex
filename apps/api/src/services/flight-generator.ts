// Deterministic flight-board generation for the Flight Garden simulation.
//
// There is no real aviation provider wired in, so the board is generated from a
// seeded PRNG over the authored catalog: the same (airport, seed, limit) always
// yields the same flights. That makes the endpoint cacheable, testable, and lets
// every screen showing the same experience agree on the board without any shared
// state. Swapping in a live provider means replacing this module only — the
// response contract in @platform/types does not change.

import type { FlightRecord, FlightRoster, FlightTerminal } from "@platform/types";
import { AIRLINES, DOMESTIC_CODES, getAirport } from "./flight-catalog.js";

/** Board rolls over once a minute when the caller doesn't pin a seed. */
const SEED_BUCKET_MS = 60_000;

/** Flights are spread across this window, so arrivals don't all land at once. */
const SCHEDULE_WINDOW_SECONDS = 1_800;

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG. Chosen over
 * Math.random specifically because it takes an explicit seed.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed derived from the current minute — stable within a bucket. */
export function currentSeed(now: number = Date.now()): number {
  return Math.floor(now / SEED_BUCKET_MS);
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  // Callers only pass non-empty arrays (catalog data), so this index is safe.
  return items[Math.floor(rng() * items.length)] as T;
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function terminalFor(otherEnd: string): FlightTerminal {
  return DOMESTIC_CODES.has(otherEnd) ? "T1" : "T2";
}

/**
 * Build a deterministic flight board for an airport.
 *
 * @returns the roster, or null if the airport isn't in the catalog.
 */
export function generateRoster(options: {
  airport: string;
  limit: number;
  seed: number;
  now?: Date;
}): FlightRoster | null {
  const { airport, limit, seed } = options;
  const meta = getAirport(airport);
  if (!meta) return null;

  const now = options.now ?? new Date();
  // Fold the airport code into the seed so two airports on the same seed don't
  // produce parallel boards.
  const codeSalt = airport.charCodeAt(0) * 65_536 + airport.charCodeAt(1) * 256 + airport.charCodeAt(2);
  const rng = mulberry32(seed ^ codeSalt);

  const flights: FlightRecord[] = [];
  for (let i = 0; i < limit; i++) {
    const airline = pick(rng, AIRLINES);
    const otherEnd = pick(rng, meta.routes);
    const kind = rng() < 0.5 ? "arrival" : "departure";
    const [rangeMin, rangeMax] = airline.flightNumberRange;

    flights.push({
      id: `${airport}-${seed}-${i}`,
      flightNumber: `${airline.code}${randInt(rng, rangeMin, rangeMax)}`,
      airline: airline.code,
      kind,
      origin: kind === "arrival" ? otherEnd : airport,
      destination: kind === "arrival" ? airport : otherEnd,
      terminal: terminalFor(otherEnd),
      // Busier airports pack the same number of flights into a tighter window.
      scheduledOffsetSeconds: Math.floor(
        (rng() * SCHEDULE_WINDOW_SECONDS) / meta.intensity
      ),
    });
  }

  flights.sort((a, b) => a.scheduledOffsetSeconds - b.scheduledOffsetSeconds);

  return {
    airport,
    generatedAt: now.toISOString(),
    seed,
    flights,
  };
}
