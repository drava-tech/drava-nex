// Flight Simulation domain — shared zod schemas + inferred types for the
// "Flight Garden" template's runtime data (see packages/ui/src/templates/
// flight-simulation). The API validates requests and shapes responses with
// these; the UI imports the inferred types only. Single source of truth for the
// contract, so a real aviation provider can replace the deterministic generator
// later without the renderer changing.

import { z } from "zod";

// ─── Field schemas ────────────────────────────────────────────────────────────

/** IATA-style 3-letter airport code, normalized to upper case. */
export const airportCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter airport code (e.g. BLR).");

/** Airline designator: 2 alphanumerics, as used by IATA (e.g. "AI", "6E"). */
export const airlineCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2}$/, "Use a 2-character airline code (e.g. 6E).");

/** Which pier a flight uses. T1 is domestic, T2 international. */
export const FLIGHT_TERMINALS = ["T1", "T2"] as const;
export const flightTerminalSchema = z.enum(FLIGHT_TERMINALS);
export type FlightTerminal = z.infer<typeof flightTerminalSchema>;

/** Direction of travel relative to the selected airport. */
export const FLIGHT_KINDS = ["arrival", "departure"] as const;
export const flightKindSchema = z.enum(FLIGHT_KINDS);
export type FlightKind = z.infer<typeof flightKindSchema>;

// ─── Catalog (GET /api/flight-simulation/airports) ────────────────────────────

export const airportSummarySchema = z.object({
  code: airportCodeSchema,
  /** HUD tower title, e.g. "BLR Garden Tower". */
  tower: z.string().min(1),
  /** Full airport name, e.g. "Kempegowda Intl". */
  full: z.string().min(1),
  city: z.string().min(1),
  /** Relative traffic level; drives spawn cadence and concurrent-flight ceiling. */
  intensity: z.number().positive().max(4),
  /** Destinations/origins reachable from here. Each is a catalog airport or city code. */
  routes: z.array(airportCodeSchema).min(1),
});
export type AirportSummary = z.infer<typeof airportSummarySchema>;

export const airlineSummarySchema = z.object({
  code: airlineCodeSchema,
  name: z.string().min(1),
  /** Livery colour used for the butterfly wings, trail and legend swatch. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Inclusive [min, max] flight-number range this carrier draws from. */
  flightNumberRange: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
});
export type AirlineSummary = z.infer<typeof airlineSummarySchema>;

export const flightCatalogSchema = z.object({
  airports: z.array(airportSummarySchema).min(1),
  airlines: z.array(airlineSummarySchema).min(1),
  /** code → display city name, for route labels ("BLR" → "Bengaluru"). */
  cities: z.record(z.string(), z.string()),
  /**
   * Route codes counted as domestic, which decides the pier a flight uses
   * (T1 domestic / T2 international). Published because the renderer applies
   * the same rule when it generates its own traffic — without this the two
   * would drift and a flight could taxi to the wrong terminal.
   */
  domesticCodes: z.array(airportCodeSchema),
});
export type FlightCatalog = z.infer<typeof flightCatalogSchema>;

// ─── Roster (GET /api/flight-simulation/flights) ──────────────────────────────

export const flightSimulationQuerySchema = z.object({
  airport: airportCodeSchema,
  /** How many flights to put on the board. */
  limit: z.coerce.number().int().min(1).max(60).default(24),
  /**
   * Deterministic generation seed. Omitted → the route derives one from the
   * current minute, so the board is stable within a minute and rolls naturally.
   */
  seed: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});
export type FlightSimulationQuery = z.infer<typeof flightSimulationQuerySchema>;

export const flightRecordSchema = z.object({
  /** Stable within a (airport, seed) board — safe as a render key. */
  id: z.string().min(1),
  /** Carrier designator + number, e.g. "6E2431". */
  flightNumber: z.string().min(3),
  airline: airlineCodeSchema,
  kind: flightKindSchema,
  origin: airportCodeSchema,
  destination: airportCodeSchema,
  terminal: flightTerminalSchema,
  /** Seconds after `generatedAt` this flight is due. Drives spawn cadence. */
  scheduledOffsetSeconds: z.number().int().min(0),
});
export type FlightRecord = z.infer<typeof flightRecordSchema>;

export const flightRosterSchema = z.object({
  airport: airportCodeSchema,
  generatedAt: z.string(),
  seed: z.number().int().min(0),
  flights: z.array(flightRecordSchema),
});
export type FlightRoster = z.infer<typeof flightRosterSchema>;
