import { Hono } from "hono";
import { describe, it, expect } from "vitest";

import { flightSimulationRouter } from "../src/routes/flight-simulation.js";
import { AIRLINES, AIRPORTS, DOMESTIC_CODES } from "../src/services/flight-catalog.js";
import { currentSeed, generateRoster } from "../src/services/flight-generator.js";
import { flightCatalogSchema, flightRosterSchema } from "@platform/types";

// The router needs no database, no MQTT and no auth — it is authored reference
// data plus a pure generator, so it mounts and runs as-is.
const app = new Hono().route("/api/flight-simulation", flightSimulationRouter);

const get = (path: string) => app.request(`/api/flight-simulation${path}`);

describe("GET /api/flight-simulation/airports", () => {
  it("returns the catalog in the standard success envelope", async () => {
    const res = await get("/airports");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    // The response must satisfy the shared contract, not just "look right".
    expect(flightCatalogSchema.safeParse(body.data).success).toBe(true);
  });

  it("is public — no credentials required", async () => {
    expect((await get("/airports")).status).toBe(200);
  });

  it("publishes the domestic split the generator actually uses", async () => {
    const { data } = await (await get("/airports")).json();
    expect(data.domesticCodes).toEqual([...DOMESTIC_CODES]);

    // The renderer relies on this to assign the same pier when it generates its
    // own traffic, so a drift here is a real bug, not a cosmetic one.
    const roster = generateRoster({ airport: "BLR", limit: 40, seed: 21 })!;
    const domestic = new Set<string>(data.domesticCodes);
    for (const f of roster.flights) {
      const other = f.kind === "arrival" ? f.origin : f.destination;
      expect(f.terminal).toBe(domestic.has(other) ? "T1" : "T2");
    }
  });

  it("every airport route resolves to a known city label", async () => {
    const { data } = await (await get("/airports")).json();
    for (const airport of data.airports) {
      for (const route of airport.routes) {
        expect(data.cities[route], `missing city for ${route}`).toBeTruthy();
      }
    }
  });
});

describe("GET /api/flight-simulation/flights", () => {
  it("returns a roster matching the shared schema", async () => {
    const res = await get("/flights?airport=BLR");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(flightRosterSchema.safeParse(body.data).success).toBe(true);
    expect(body.data.airport).toBe("BLR");
  });

  it("defaults to 24 flights and honours an explicit limit", async () => {
    const { data: def } = await (await get("/flights?airport=BLR")).json();
    expect(def.flights).toHaveLength(24);

    const { data: capped } = await (await get("/flights?airport=BLR&limit=5")).json();
    expect(capped.flights).toHaveLength(5);
  });

  it("normalizes a lowercase airport code", async () => {
    const res = await get("/flights?airport=blr");
    expect(res.status).toBe(200);
    expect((await res.json()).data.airport).toBe("BLR");
  });

  it("rejects a malformed airport code with 422 and field details", async () => {
    for (const bad of ["B", "BLRX", "12"]) {
      const res = await get(`/flights?airport=${bad}`);
      expect(res.status, `expected 422 for "${bad}"`).toBe(422);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("VALIDATION");
      expect(body.error.details[0].field).toBe("airport");
    }
  });

  it("rejects a missing airport with 422", async () => {
    const res = await get("/flights");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("VALIDATION");
  });

  it("rejects an out-of-range limit with 422", async () => {
    expect((await get("/flights?airport=BLR&limit=0")).status).toBe(422);
    expect((await get("/flights?airport=BLR&limit=61")).status).toBe(422);
    expect((await get("/flights?airport=BLR&limit=abc")).status).toBe(422);
  });

  it("returns 404 for a well-formed but unknown airport", async () => {
    const res = await get("/flights?airport=ZZZ");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNKNOWN_AIRPORT");
  });
});

describe("flight roster determinism", () => {
  it("produces an identical board for the same airport and seed", async () => {
    const a = await (await get("/flights?airport=BLR&seed=42")).json();
    const b = await (await get("/flights?airport=BLR&seed=42")).json();
    expect(a.data.flights).toEqual(b.data.flights);
    expect(a.data.seed).toBe(42);
  });

  it("produces a different board for a different seed", async () => {
    const a = await (await get("/flights?airport=BLR&seed=1")).json();
    const b = await (await get("/flights?airport=BLR&seed=2")).json();
    expect(a.data.flights).not.toEqual(b.data.flights);
  });

  it("does not produce parallel boards across airports on the same seed", () => {
    const blr = generateRoster({ airport: "BLR", limit: 24, seed: 7 });
    const del = generateRoster({ airport: "DEL", limit: 24, seed: 7 });
    expect(blr!.flights.map((f) => f.flightNumber)).not.toEqual(
      del!.flights.map((f) => f.flightNumber)
    );
  });

  it("derives a stable seed within the same minute and rolls over after it", () => {
    const t = 1_800_000_000_000;
    expect(currentSeed(t)).toBe(currentSeed(t + 59_000));
    expect(currentSeed(t)).not.toBe(currentSeed(t + 60_000));
  });
});

describe("generateRoster", () => {
  const airlineCodes = new Set(AIRLINES.map((a) => a.code));

  it("returns null for an airport outside the catalog", () => {
    expect(generateRoster({ airport: "ZZZ", limit: 10, seed: 1 })).toBeNull();
  });

  it("orders flights by schedule", () => {
    const roster = generateRoster({ airport: "LHR", limit: 40, seed: 99 })!;
    const offsets = roster.flights.map((f) => f.scheduledOffsetSeconds);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("keeps every flight consistent with the catalog", () => {
    for (const airport of AIRPORTS) {
      const roster = generateRoster({ airport: airport.code, limit: 30, seed: 5 })!;
      const routes = new Set(airport.routes);

      for (const flight of roster.flights) {
        expect(airlineCodes).toContain(flight.airline);
        expect(flight.flightNumber.startsWith(flight.airline)).toBe(true);

        // Exactly one end of the route is the selected airport; the other must
        // be a destination that airport actually serves.
        const other = flight.kind === "arrival" ? flight.origin : flight.destination;
        const self = flight.kind === "arrival" ? flight.destination : flight.origin;
        expect(self).toBe(airport.code);
        expect(routes).toContain(other);

        expect(flight.scheduledOffsetSeconds).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("assigns flight numbers inside each carrier's range", () => {
    const roster = generateRoster({ airport: "BOM", limit: 60, seed: 3 })!;
    for (const flight of roster.flights) {
      const airline = AIRLINES.find((a) => a.code === flight.airline)!;
      const number = Number(flight.flightNumber.slice(airline.code.length));
      expect(number).toBeGreaterThanOrEqual(airline.flightNumberRange[0]);
      expect(number).toBeLessThanOrEqual(airline.flightNumberRange[1]);
    }
  });

  it("picks the terminal from the far end of the route, not the selected airport", () => {
    const roster = generateRoster({ airport: "BLR", limit: 60, seed: 11 })!;
    for (const flight of roster.flights) {
      const other = flight.kind === "arrival" ? flight.origin : flight.destination;
      expect(flight.terminal).toBe(DOMESTIC_CODES.has(other) ? "T1" : "T2");
    }
  });

  it("sends international sectors to T2 and domestic ones to T1", () => {
    const roster = generateRoster({ airport: "BLR", limit: 60, seed: 11 })!;
    const terminalFor = (code: string) =>
      roster.flights
        .filter((f) => (f.kind === "arrival" ? f.origin : f.destination) === code)
        .map((f) => f.terminal);

    // LHR is in the catalog but is *not* domestic — the split is by sector, not
    // by "is this a known airport".
    expect(terminalFor("LHR").every((t) => t === "T2")).toBe(true);
    expect(terminalFor("DXB").every((t) => t === "T2")).toBe(true);
    expect(terminalFor("DEL").every((t) => t === "T1")).toBe(true);
  });
});
