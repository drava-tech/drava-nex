/**
 * Every city the Drava Mosaic's World Clock may ask WeatherAPI about.
 *
 * An allowlist, not a passthrough — the clock sends ids, never a raw query, so
 * GET /api/drava-mosaic/weather cannot be turned into an open relay for
 * arbitrary lookups against our key. Same role flight-locations.ts plays for
 * the wind route.
 *
 * The browser-side half is LOCATIONS in
 * packages/drava-mosaic/world-clock/locations.js; the ids must match (a test
 * in apps/api/test/drava-mosaic.test.ts checks it). Values are the WeatherAPI
 * `q`: "city, country" so e.g. "Lima" can't resolve to Lima, Ohio. This file is
 * the security boundary.
 */
const CLOCK_LOCATIONS: Record<string, string> = {
  amsterdam: "Amsterdam, Netherlands",
  athens: "Athens, Greece",
  auckland: "Auckland, New Zealand",
  bangkok: "Bangkok, Thailand",
  barcelona: "Barcelona, Spain",
  beijing: "Beijing, China",
  bengaluru: "Bengaluru, India",
  berlin: "Berlin, Germany",
  bogota: "Bogota, Colombia",
  buenosaires: "Buenos Aires, Argentina",
  cairo: "Cairo, Egypt",
  capetown: "Cape Town, South Africa",
  chicago: "Chicago, United States",
  copenhagen: "Copenhagen, Denmark",
  dubai: "Dubai, United Arab Emirates",
  dublin: "Dublin, Ireland",
  edinburgh: "Edinburgh, United Kingdom",
  hanoi: "Hanoi, Vietnam",
  helsinki: "Helsinki, Finland",
  honolulu: "Honolulu, United States",
  istanbul: "Istanbul, Turkey",
  jakarta: "Jakarta, Indonesia",
  johannesburg: "Johannesburg, South Africa",
  lagos: "Lagos, Nigeria",
  lima: "Lima, Peru",
  lisbon: "Lisbon, Portugal",
  london: "London, United Kingdom",
  losangeles: "Los Angeles, United States",
  madrid: "Madrid, Spain",
  manila: "Manila, Philippines",
  marrakesh: "Marrakesh, Morocco",
  melbourne: "Melbourne, Australia",
  mexicocity: "Mexico City, Mexico",
  miami: "Miami, United States",
  milan: "Milan, Italy",
  moscow: "Moscow, Russia",
  mumbai: "Mumbai, India",
  munich: "Munich, Germany",
  nairobi: "Nairobi, Kenya",
  newdelhi: "New Delhi, India",
  newyork: "New York, United States",
  osaka: "Osaka, Japan",
  oslo: "Oslo, Norway",
  paris: "Paris, France",
  perth: "Perth, Australia",
  reykjavik: "Reykjavik, Iceland",
  riodejaneiro: "Rio de Janeiro, Brazil",
  riyadh: "Riyadh, Saudi Arabia",
  rome: "Rome, Italy",
  sanfrancisco: "San Francisco, United States",
  santiago: "Santiago, Chile",
  saopaulo: "São Paulo, Brazil",
  seoul: "Seoul, South Korea",
  shanghai: "Shanghai, China",
  singapore: "Singapore, Singapore",
  stockholm: "Stockholm, Sweden",
  sydney: "Sydney, Australia",
  tokyo: "Tokyo, Japan",
  toronto: "Toronto, Canada",
  vancouver: "Vancouver, Canada",
  zurich: "Zurich, Switzerland",
};

/** The clock has room for this many bands, so a request may name at most this many. */
export const MAX_CLOCK_PLACES = 5;

/** Resolves a World Clock place id to its WeatherAPI query, or null if not allowlisted. */
export function resolveClockLocation(id: string): string | null {
  return Object.prototype.hasOwnProperty.call(CLOCK_LOCATIONS, id) ? (CLOCK_LOCATIONS[id] ?? null) : null;
}

/** Every allowlisted id — exported for the sync test against the studio's list. */
export const CLOCK_LOCATION_IDS = Object.keys(CLOCK_LOCATIONS);
