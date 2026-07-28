// Canonical reference data for the Flight Garden simulation: which airports can
// be shown, which carriers fly there, and what the routes are.
//
// This is authored data, not database data — the garden is a visualization, not
// a booking system, so there is nothing for an operator to CRUD here. Lifted
// verbatim from the original standalone simulation's AIRLINES/CITIES/AIRPORTS
// tables so the visual output is unchanged.
//
// The renderer keeps its own copy of these tables as an offline fallback (see
// packages/ui/.../engine): the deliberate duplication is what lets an unattended
// screen keep running when the API is unreachable.

import type { AirlineSummary, AirportSummary, FlightCatalog } from "@platform/types";

export const AIRLINES: AirlineSummary[] = [
  { code: "AI", name: "Air India", color: "#e05a45", flightNumberRange: [100, 899] },
  { code: "6E", name: "IndiGo", color: "#4f7cf5", flightNumberRange: [2000, 2999] },
  { code: "UK", name: "Vistara", color: "#b487f0", flightNumberRange: [800, 999] },
  { code: "EK", name: "Emirates", color: "#e8b44c", flightNumberRange: [500, 599] },
  { code: "QR", name: "Qatar Airways", color: "#c8577f", flightNumberRange: [500, 699] },
  { code: "LH", name: "Lufthansa", color: "#e9d16a", flightNumberRange: [750, 799] },
  { code: "BA", name: "British Airways", color: "#7fa8e8", flightNumberRange: [100, 299] },
];

export const CITIES: Record<string, string> = {
  BLR: "Bengaluru", DEL: "Delhi", BOM: "Mumbai", MAA: "Chennai",
  HYD: "Hyderabad", LHR: "London", DXB: "Dubai", DOH: "Doha",
  SIN: "Singapore", FRA: "Frankfurt", CCU: "Kolkata", GOI: "Goa",
  JFK: "New York", AMS: "Amsterdam", HKG: "Hong Kong", BKK: "Bangkok",
  CDG: "Paris", SYD: "Sydney",
};

export const AIRPORTS: AirportSummary[] = [
  {
    code: "BLR", tower: "BLR Garden Tower", full: "Kempegowda Intl",
    city: "Bengaluru", intensity: 1.0,
    routes: ["DEL", "BOM", "DXB", "SIN", "MAA", "HYD", "LHR", "DOH"],
  },
  {
    code: "DEL", tower: "DEL Garden Tower", full: "Indira Gandhi Intl",
    city: "Delhi", intensity: 1.35,
    routes: ["BLR", "BOM", "DXB", "FRA", "LHR", "CCU", "MAA", "JFK"],
  },
  {
    code: "BOM", tower: "BOM Garden Tower", full: "Chhatrapati Shivaji",
    city: "Mumbai", intensity: 1.2,
    routes: ["DEL", "BLR", "GOI", "DXB", "DOH", "LHR", "SIN", "AMS"],
  },
  {
    code: "MAA", tower: "MAA Garden Tower", full: "Chennai Intl",
    city: "Chennai", intensity: 0.85,
    routes: ["BLR", "HYD", "CCU", "SIN", "DXB", "BKK", "DEL"],
  },
  {
    code: "HYD", tower: "HYD Garden Tower", full: "Rajiv Gandhi Intl",
    city: "Hyderabad", intensity: 0.9,
    routes: ["BLR", "DEL", "BOM", "DXB", "DOH", "MAA", "SIN"],
  },
  {
    code: "LHR", tower: "LHR Garden Tower", full: "London Heathrow",
    city: "London", intensity: 1.5,
    routes: ["JFK", "CDG", "AMS", "FRA", "DXB", "HKG", "DEL", "SYD"],
  },
];

/**
 * Domestic (Indian) sectors taxi to the T1 petals; everything else goes to T2.
 * Mirrors the original simulation's DOMESTIC_CODES split.
 */
export const DOMESTIC_CODES = new Set(["BLR", "DEL", "BOM", "MAA", "HYD", "CCU", "GOI"]);

const AIRPORTS_BY_CODE = new Map(AIRPORTS.map((a) => [a.code, a]));

export function getAirport(code: string): AirportSummary | undefined {
  return AIRPORTS_BY_CODE.get(code);
}

export function getCatalog(): FlightCatalog {
  return {
    airports: AIRPORTS,
    airlines: AIRLINES,
    cities: CITIES,
    // Published so the renderer's own fallback generation splits terminals the
    // same way this service does.
    domesticCodes: [...DOMESTIC_CODES],
  };
}
