/**
 * Every place the Flight Garden's weather scene is allowed to query WeatherAPI
 * for.
 *
 * An allowlist, not a passthrough — the client sends an id, never a raw query
 * string, so a request to /api/flight-simulation/wind cannot be turned into an
 * open relay for arbitrary WeatherAPI lookups against our key. Mirrors the role
 * VIDEO_KEYS plays in flight-video.ts.
 *
 * The browser-side half of this table is WEATHER_LOCATIONS in
 * flight-garden.js; the ids must match, and the order there is what the
 * dropdown shows. This file is the security boundary.
 */

export interface WeatherLocation {
  label: string;
  /** What actually gets sent to WeatherAPI as `q`. */
  query: string;
}

const LOCATIONS: Record<string, WeatherLocation> = {
  bengaluru: { label: "Bengaluru, India", query: "Bengaluru" },
  reykjavik: { label: "Reykjavik, Iceland", query: "Reykjavik" },
  oslo: { label: "Oslo, Norway", query: "Oslo" },
  london: { label: "London, United Kingdom", query: "London" },
  newyork: { label: "New York, United States", query: "New York" },
  tokyo: { label: "Tokyo, Japan", query: "Tokyo" },
  dubai: { label: "Dubai, UAE", query: "Dubai" },
  cairo: { label: "Cairo, Egypt", query: "Cairo" },
  sydney: { label: "Sydney, Australia", query: "Sydney" },
  riodejaneiro: { label: "Rio de Janeiro, Brazil", query: "Rio de Janeiro" },
};

const DEFAULT_LOCATION_ID = "bengaluru";

/**
 * Resolves a request's `?location=` to a WeatherAPI query, or null when it is
 * not allowlisted. An omitted location falls back to the default rather than
 * being treated as an error.
 */
export function resolveLocation(id: string | undefined): WeatherLocation | null {
  if (!id) return LOCATIONS[DEFAULT_LOCATION_ID] ?? null;
  return Object.prototype.hasOwnProperty.call(LOCATIONS, id) ? (LOCATIONS[id] ?? null) : null;
}
