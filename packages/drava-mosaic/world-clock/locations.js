/**
 * Every city the landing page offers. Shared by the browser (display names)
 * and api/weather.js (the WeatherAPI query). The API only accepts ids from
 * this list, so the route can't be used for arbitrary lookups against our
 * key. `tz` lets the clocks run before the first weather response arrives;
 * after that WeatherAPI's tz_id is used. `query` overrides the WeatherAPI
 * search where "city, country" resolves to the wrong place. `iso` (ISO 3166-1 numeric) finds the
 * city's country on the background map and `lat`/`lon` place the city on it.
 */
export const LOCATIONS = [
  { id: "amsterdam", city: "Amsterdam", country: "Netherlands", iso: "528", lat: 52.37, lon: 4.9, tz: "Europe/Amsterdam" },
  { id: "athens", city: "Athens", country: "Greece", iso: "300", lat: 37.98, lon: 23.73, tz: "Europe/Athens" },
  { id: "auckland", city: "Auckland", country: "New Zealand", iso: "554", lat: -36.85, lon: 174.76, tz: "Pacific/Auckland" },
  { id: "bangkok", city: "Bangkok", country: "Thailand", iso: "764", lat: 13.76, lon: 100.5, tz: "Asia/Bangkok" },
  { id: "barcelona", city: "Barcelona", country: "Spain", iso: "724", lat: 41.39, lon: 2.17, tz: "Europe/Madrid" },
  { id: "beijing", city: "Beijing", country: "China", iso: "156", lat: 39.9, lon: 116.4, tz: "Asia/Shanghai" },
  { id: "bengaluru", city: "Bengaluru", country: "India", iso: "356", lat: 12.97, lon: 77.59, tz: "Asia/Kolkata" },
  { id: "berlin", city: "Berlin", country: "Germany", iso: "276", lat: 52.52, lon: 13.4, tz: "Europe/Berlin" },
  { id: "bogota", city: "Bogotá", query: "Bogota, Colombia", country: "Colombia", iso: "170", lat: 4.71, lon: -74.07, tz: "America/Bogota" },
  { id: "buenosaires", city: "Buenos Aires", country: "Argentina", iso: "032", lat: -34.6, lon: -58.38, tz: "America/Argentina/Buenos_Aires" },
  { id: "cairo", city: "Cairo", country: "Egypt", iso: "818", lat: 30.04, lon: 31.24, tz: "Africa/Cairo" },
  { id: "capetown", city: "Cape Town", country: "South Africa", iso: "710", lat: -33.92, lon: 18.42, tz: "Africa/Johannesburg" },
  { id: "chicago", city: "Chicago", country: "United States", iso: "840", lat: 41.88, lon: -87.63, tz: "America/Chicago" },
  { id: "copenhagen", city: "Copenhagen", country: "Denmark", iso: "208", lat: 55.68, lon: 12.57, tz: "Europe/Copenhagen" },
  { id: "dubai", city: "Dubai", country: "United Arab Emirates", iso: "784", lat: 25.2, lon: 55.27, tz: "Asia/Dubai" },
  { id: "dublin", city: "Dublin", country: "Ireland", iso: "372", lat: 53.35, lon: -6.26, tz: "Europe/Dublin" },
  { id: "edinburgh", city: "Edinburgh", country: "United Kingdom", iso: "826", lat: 55.95, lon: -3.19, tz: "Europe/London" },
  { id: "hanoi", city: "Hanoi", country: "Vietnam", iso: "704", lat: 21.03, lon: 105.85, tz: "Asia/Ho_Chi_Minh" },
  { id: "helsinki", city: "Helsinki", country: "Finland", iso: "246", lat: 60.17, lon: 24.94, tz: "Europe/Helsinki" },
  { id: "honolulu", city: "Honolulu", country: "United States", iso: "840", lat: 21.31, lon: -157.86, tz: "Pacific/Honolulu" },
  { id: "istanbul", city: "Istanbul", country: "Turkey", iso: "792", lat: 41.01, lon: 28.98, tz: "Europe/Istanbul" },
  { id: "jakarta", city: "Jakarta", country: "Indonesia", iso: "360", lat: -6.21, lon: 106.85, tz: "Asia/Jakarta" },
  { id: "johannesburg", city: "Johannesburg", country: "South Africa", iso: "710", lat: -26.2, lon: 28.05, tz: "Africa/Johannesburg" },
  { id: "lagos", city: "Lagos", country: "Nigeria", iso: "566", lat: 6.52, lon: 3.38, tz: "Africa/Lagos" },
  { id: "lima", city: "Lima", country: "Peru", iso: "604", lat: -12.05, lon: -77.04, tz: "America/Lima" },
  { id: "lisbon", city: "Lisbon", country: "Portugal", iso: "620", lat: 38.72, lon: -9.14, tz: "Europe/Lisbon" },
  { id: "london", city: "London", country: "United Kingdom", iso: "826", lat: 51.51, lon: -0.13, tz: "Europe/London" },
  { id: "losangeles", city: "Los Angeles", country: "United States", iso: "840", lat: 34.05, lon: -118.24, tz: "America/Los_Angeles" },
  { id: "madrid", city: "Madrid", country: "Spain", iso: "724", lat: 40.42, lon: -3.7, tz: "Europe/Madrid" },
  { id: "manila", city: "Manila", country: "Philippines", iso: "608", lat: 14.6, lon: 120.98, tz: "Asia/Manila" },
  { id: "marrakesh", city: "Marrakesh", country: "Morocco", iso: "504", lat: 31.63, lon: -8.01, tz: "Africa/Casablanca" },
  { id: "melbourne", city: "Melbourne", country: "Australia", iso: "036", lat: -37.81, lon: 144.96, tz: "Australia/Melbourne" },
  { id: "mexicocity", city: "Mexico City", country: "Mexico", iso: "484", lat: 19.43, lon: -99.13, tz: "America/Mexico_City" },
  { id: "miami", city: "Miami", country: "United States", iso: "840", lat: 25.76, lon: -80.19, tz: "America/New_York" },
  { id: "milan", city: "Milan", country: "Italy", iso: "380", lat: 45.46, lon: 9.19, tz: "Europe/Rome" },
  { id: "moscow", city: "Moscow", country: "Russia", iso: "643", lat: 55.76, lon: 37.62, tz: "Europe/Moscow" },
  { id: "mumbai", city: "Mumbai", country: "India", iso: "356", lat: 19.08, lon: 72.88, tz: "Asia/Kolkata" },
  { id: "munich", city: "Munich", country: "Germany", iso: "276", lat: 48.14, lon: 11.58, tz: "Europe/Berlin" },
  { id: "nairobi", city: "Nairobi", country: "Kenya", iso: "404", lat: -1.29, lon: 36.82, tz: "Africa/Nairobi" },
  { id: "newdelhi", city: "New Delhi", country: "India", iso: "356", lat: 28.61, lon: 77.21, tz: "Asia/Kolkata" },
  { id: "newyork", city: "New York", country: "United States", iso: "840", lat: 40.71, lon: -74.01, tz: "America/New_York" },
  { id: "osaka", city: "Osaka", country: "Japan", iso: "392", lat: 34.69, lon: 135.5, tz: "Asia/Tokyo" },
  { id: "oslo", city: "Oslo", country: "Norway", iso: "578", lat: 59.91, lon: 10.75, tz: "Europe/Oslo" },
  { id: "paris", city: "Paris", country: "France", iso: "250", lat: 48.86, lon: 2.35, tz: "Europe/Paris" },
  { id: "perth", city: "Perth", country: "Australia", iso: "036", lat: -31.95, lon: 115.86, tz: "Australia/Perth" },
  { id: "reykjavik", city: "Reykjavik", country: "Iceland", iso: "352", lat: 64.15, lon: -21.94, tz: "Atlantic/Reykjavik" },
  { id: "riodejaneiro", city: "Rio de Janeiro", country: "Brazil", iso: "076", lat: -22.91, lon: -43.17, tz: "America/Sao_Paulo" },
  { id: "riyadh", city: "Riyadh", country: "Saudi Arabia", iso: "682", lat: 24.71, lon: 46.68, tz: "Asia/Riyadh" },
  { id: "rome", city: "Rome", country: "Italy", iso: "380", lat: 41.9, lon: 12.5, tz: "Europe/Rome" },
  { id: "sanfrancisco", city: "San Francisco", country: "United States", iso: "840", lat: 37.77, lon: -122.42, tz: "America/Los_Angeles" },
  { id: "santiago", city: "Santiago", country: "Chile", iso: "152", lat: -33.45, lon: -70.67, tz: "America/Santiago" },
  { id: "saopaulo", city: "São Paulo", country: "Brazil", iso: "076", lat: -23.55, lon: -46.63, tz: "America/Sao_Paulo" },
  { id: "seoul", city: "Seoul", country: "South Korea", iso: "410", lat: 37.57, lon: 126.98, tz: "Asia/Seoul" },
  { id: "shanghai", city: "Shanghai", country: "China", iso: "156", lat: 31.23, lon: 121.47, tz: "Asia/Shanghai" },
  { id: "singapore", city: "Singapore", country: "Singapore", iso: "702", lat: 1.35, lon: 103.82, tz: "Asia/Singapore" },
  { id: "stockholm", city: "Stockholm", country: "Sweden", iso: "752", lat: 59.33, lon: 18.07, tz: "Europe/Stockholm" },
  { id: "sydney", city: "Sydney", country: "Australia", iso: "036", lat: -33.87, lon: 151.21, tz: "Australia/Sydney" },
  { id: "tokyo", city: "Tokyo", country: "Japan", iso: "392", lat: 35.68, lon: 139.69, tz: "Asia/Tokyo" },
  { id: "toronto", city: "Toronto", country: "Canada", iso: "124", lat: 43.65, lon: -79.38, tz: "America/Toronto" },
  { id: "vancouver", city: "Vancouver", country: "Canada", iso: "124", lat: 49.28, lon: -123.12, tz: "America/Vancouver" },
  { id: "zurich", city: "Zurich", country: "Switzerland", iso: "756", lat: 47.38, lon: 8.54, tz: "Europe/Zurich" },
];

export const LOCATIONS_BY_ID = new Map(LOCATIONS.map((place) => [place.id, place]));

// The picker used to offer one city per country under a country id. Old
// bookmarks and remembered selections still use those ids, so map each to
// the city it stood for.
const LEGACY_IDS = {
  usa: "newyork",
  uk: "london",
  india: "bengaluru",
  japan: "tokyo",
  australia: "sydney",
  argentina: "buenosaires",
  brazil: "riodejaneiro",
  canada: "toronto",
  chile: "santiago",
  china: "beijing",
  egypt: "cairo",
  france: "paris",
  germany: "berlin",
  greece: "athens",
  iceland: "reykjavik",
  indonesia: "jakarta",
  italy: "rome",
  kenya: "nairobi",
  mexico: "mexicocity",
  morocco: "marrakesh",
  netherlands: "amsterdam",
  newzealand: "auckland",
  nigeria: "lagos",
  norway: "oslo",
  peru: "lima",
  russia: "moscow",
  saudiarabia: "riyadh",
  southafrica: "capetown",
  southkorea: "seoul",
  spain: "madrid",
  sweden: "stockholm",
  switzerland: "zurich",
  thailand: "bangkok",
  turkey: "istanbul",
  uae: "dubai",
  vietnam: "hanoi",
};

/** The current id for `id`, which may be a legacy country id. */
export function resolvePlaceId(id) {
  return Object.hasOwn(LEGACY_IDS, id) ? LEGACY_IDS[id] : id;
}

// The clock has room for this many bands.
export const MAX_PLACES = 5;

// Preselected on the landing page the first time it is opened.
export const DEFAULT_PLACE_IDS = ["newyork", "london", "bengaluru", "tokyo", "sydney"];
