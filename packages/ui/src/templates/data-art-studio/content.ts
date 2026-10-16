// Content shape for the Data Art Studio template — the standalone Data Art
// Studio app (VelocityMap studio, Flight Garden, World Clock), built from
// packages/data-art-studio and served by the CMS as static pages under
// /data-art-studio/. Stored on the experience as
// experience.templateContent["data-art-studio"].
//
// Like Flight Simulation this holds ONLY presentation config — which page the
// screen opens on and, for the World Clock, which clock it shows. Live data
// (weather, attendance) and the video renders come from
// /api/data-art-studio/* at render time.

/** Which of the studio's pages a screen opens on. */
export const DATA_ART_STUDIO_ENTRIES = ["studio", "flight-garden", "world-clock"] as const;
export type DataArtStudioEntry = (typeof DATA_ART_STUDIO_ENTRIES)[number];

export const DATA_ART_STUDIO_ENTRY_LABELS: Record<DataArtStudioEntry, string> = {
  studio: "Studio (art picker, Weather & Attendance outputs)",
  "flight-garden": "Flight Garden",
  "world-clock": "World Clock",
};

/** Mirrors ARTS in packages/data-art-studio/world-clock/arts.js. */
export const WORLD_CLOCK_ARTS = ["map", "fabric"] as const;
export type WorldClockArt = (typeof WORLD_CLOCK_ARTS)[number];

/** Mirrors CLOCK_STYLES in packages/data-art-studio/world-clock/landing.js. */
export const WORLD_CLOCK_STYLES = ["analog", "digital"] as const;
export type WorldClockStyle = (typeof WORLD_CLOCK_STYLES)[number];

/** The clock has room for this many cities (MAX_PLACES in locations.js). */
export const WORLD_CLOCK_MAX_PLACES = 5;

export interface DataArtStudioContent {
  entry: DataArtStudioEntry;
  /**
   * World Clock only: city ids from world-clock/locations.js (e.g. "london").
   * Empty = open on the clock's own city picker instead of a running clock.
   */
  clockPlaces: string[];
  /** World Clock only: the artwork behind the bands. */
  clockArt: WorldClockArt;
  /** World Clock only: analog or digital face. */
  clockStyle: WorldClockStyle;
}

export const DEFAULT_DATA_ART_STUDIO_CONTENT: DataArtStudioContent = {
  entry: "studio",
  clockPlaces: [],
  clockArt: "map",
  clockStyle: "analog",
};

/** Where apps/cms serves the built studio (see apps/cms/scripts/sync-data-art-studio.mjs). */
export const DATA_ART_STUDIO_BASE_URL = "/data-art-studio/";

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Reads the data-art-studio content slice off an experience row, or null if
 * unset. Tolerates partial/legacy slices by merging over the defaults, and
 * coerces every field so a hand-edited value can't produce a broken URL.
 */
export function readDataArtStudioContent(
  templateContent: Record<string, unknown> | null | undefined
): DataArtStudioContent | null {
  const slice = templateContent?.["data-art-studio"];
  if (!slice || typeof slice !== "object") return null;
  const raw = slice as Partial<Record<keyof DataArtStudioContent, unknown>>;

  const places = Array.isArray(raw.clockPlaces) ? raw.clockPlaces : [];
  return {
    entry: oneOf(raw.entry, DATA_ART_STUDIO_ENTRIES, DEFAULT_DATA_ART_STUDIO_CONTENT.entry),
    clockPlaces: [
      ...new Set(
        places
          .filter((p): p is string => typeof p === "string")
          .map((p) => p.trim().toLowerCase())
          .filter((p) => /^[a-z]+$/.test(p))
      ),
    ].slice(0, WORLD_CLOCK_MAX_PLACES),
    clockArt: oneOf(raw.clockArt, WORLD_CLOCK_ARTS, DEFAULT_DATA_ART_STUDIO_CONTENT.clockArt),
    clockStyle: oneOf(raw.clockStyle, WORLD_CLOCK_STYLES, DEFAULT_DATA_ART_STUDIO_CONTENT.clockStyle),
  };
}

/**
 * The page URL for a content config. The pages are opened standalone (never
 * with ?embed=1): embed mode adds "back to studio" buttons that message a
 * parent studio page, which inside the CMS iframe would go nowhere.
 */
export function dataArtStudioUrl(
  content: DataArtStudioContent,
  baseUrl: string = DATA_ART_STUDIO_BASE_URL
): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  switch (content.entry) {
    case "flight-garden":
      return `${base}flight-garden/index.html`;
    case "world-clock": {
      const params = new URLSearchParams();
      if (content.clockPlaces.length) params.set("places", content.clockPlaces.join(","));
      params.set("art", content.clockArt);
      params.set("clock", content.clockStyle);
      // URLSearchParams encodes the commas; the clock splits the decoded value.
      return `${base}world-clock/index.html?${params.toString()}`;
    }
    default:
      return `${base}velocitymapping.html`;
  }
}
