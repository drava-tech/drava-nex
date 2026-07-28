// Runtime data for the Flight Garden simulation template.
//
// Both reads are PUBLIC: display screens run unauthenticated (same as
// GET /api/products/:id/display), and this is authored reference data plus a
// procedurally generated board — nothing tenant-specific or sensitive.
//
// The renderer treats this API as an enhancement, not a dependency: on any
// failure it falls back to local generation, so an unattended screen never
// blanks. Keep that contract in mind before making anything here fatal.

import { Hono } from "hono";
import { flightSimulationQuerySchema, formatZodError } from "@platform/types";
import { ok, fail } from "../lib/response.js";
import { getCatalog } from "../services/flight-catalog.js";
import { currentSeed, generateRoster } from "../services/flight-generator.js";

export const flightSimulationRouter = new Hono();

// GET /api/flight-simulation/airports — the selectable airport + carrier catalog.
flightSimulationRouter.get("/airports", (c) => {
  return ok(c, getCatalog());
});

// GET /api/flight-simulation/flights?airport=BLR&limit=24&seed=123
flightSimulationRouter.get("/flights", (c) => {
  const parsed = flightSimulationQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return fail(c, "VALIDATION", "Invalid query.", 422, formatZodError(parsed.error));
  }

  const { airport, limit } = parsed.data;
  const seed = parsed.data.seed ?? currentSeed();

  const roster = generateRoster({ airport, limit, seed });
  if (!roster) {
    return fail(c, "UNKNOWN_AIRPORT", `No airport in the catalog matches "${airport}".`, 404);
  }

  return ok(c, roster);
});
