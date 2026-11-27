// Content shape for the Story template — an interactive, touch-driven
// storytelling experience for a touchscreen or touch video wall. Stored on the
// experience as experience.templateContent.story (same keyed-JSONB convention
// as every template; readStoryContent normalises whatever is stored).
//
// Structure a viewer moves through:
//   idle screen (attract loop)  ── tap ──▶  home (branded menu of apps)
//        ▲                                   │ tap a tile
//        └── no touch for idle.timeoutSeconds ┴─▶ app: timeline | map | showcase | hotspots | video
//                                                    │ tap an item
//                                                    ▼
//                                                 detail lightbox (text + images/video/PDF)

export interface StoryMedia {
  id: string;
  type: "image" | "video" | "pdf";
  url: string;
  assetId?: string;
  name?: string;
}

/** Anything that opens the detail lightbox when tapped. */
export interface StoryDetail {
  title: string;
  /** Short line under the title on cards/pins. */
  subtitle: string;
  body: string;
  media: StoryMedia[];
}

export interface StoryFilter {
  id: string;
  label: string;
  /** Pins and chips use it; ignored by the timeline/showcase chips. */
  color: string;
}

export interface StoryTimelineEvent extends StoryDetail {
  id: string;
  /** Sort key (e.g. 1998). */
  year: number;
  /** What the marker shows ("1998", "Q3 2021", "Phase 2"); empty = the year. */
  dateLabel: string;
  filterId: string | null;
}

export interface StoryMapPin extends StoryDetail {
  id: string;
  /** Position on the map image, 0–100 % from the left / top. */
  x: number;
  y: number;
  filterId: string | null;
}

/** A tappable area on the map, as a polygon in 0–100 % image coordinates. */
export interface StoryMapRegion extends StoryDetail {
  id: string;
  points: { x: number; y: number }[];
  filterId: string | null;
}

/**
 * How a map app presents its places:
 *  - pins:    tappable markers, colour-coded by category
 *  - journey: the pins in list order, joined by a route that draws itself
 *             stop by stop (expansion, a founder's travels, a supply chain)
 *  - regions: tappable areas that light up (states, quarters, campus zones)
 */
export type StoryMapMode = "pins" | "journey" | "regions";

export const STORY_MAP_MODES: { mode: StoryMapMode; label: string; description: string }[] = [
  { mode: "pins", label: "Pins", description: "Tappable markers, colour-coded by category" },
  { mode: "journey", label: "Journey", description: "A route that draws itself stop by stop, in list order" },
  { mode: "regions", label: "Regions", description: "Tappable areas that light up — states, quarters, zones" },
];

/**
 * One chapter of a video app. Plays its video; a voice-over, when set,
 * narrates over it (the video is muted and loops under the narration) — or
 * over a still image, for a narrated photo. `body` is the transcript, shown
 * as captions on demand.
 */
export interface StoryVideoChapter extends StoryDetail {
  id: string;
  videoUrl: string | null;
  /** Poster for the video, or the still that a voice-over plays over. */
  posterUrl: string | null;
  voiceUrl: string | null;
}

export interface StoryShowcaseItem extends StoryDetail {
  id: string;
  coverUrl: string | null;
  filterId: string | null;
}

export interface StoryHotspot extends StoryDetail {
  id: string;
  x: number;
  y: number;
}

interface StoryAppBase {
  id: string;
  title: string;
  /** One line on the home tile. */
  tagline: string;
  /** Home tile image; null = an accent-coloured tile with the app's icon. */
  coverUrl: string | null;
}

export interface StoryTimelineApp extends StoryAppBase {
  kind: "timeline";
  filters: StoryFilter[];
  events: StoryTimelineEvent[];
}

export interface StoryMapApp extends StoryAppBase {
  kind: "map";
  /** The map artwork (world, region, campus, floor plan…); null = a plain grid. */
  mapUrl: string | null;
  mode: StoryMapMode;
  /**
   * Journey only: drive it with a round jog dial (finger, a tangible puck on
   * a touch table, or a rotary controller) instead of previous/next buttons.
   */
  dial: boolean;
  filters: StoryFilter[];
  /** Pins mode, and the stops of a journey (in order). */
  pins: StoryMapPin[];
  regions: StoryMapRegion[];
}

export interface StoryShowcaseApp extends StoryAppBase {
  kind: "showcase";
  filters: StoryFilter[];
  items: StoryShowcaseItem[];
}

export interface StoryHotspotApp extends StoryAppBase {
  kind: "hotspots";
  imageUrl: string | null;
  hotspots: StoryHotspot[];
}

export interface StoryVideoApp extends StoryAppBase {
  kind: "video";
  /** Play the next chapter when one ends. */
  autoAdvance: boolean;
  chapters: StoryVideoChapter[];
}

export type StoryApp = StoryTimelineApp | StoryMapApp | StoryShowcaseApp | StoryHotspotApp | StoryVideoApp;
export type StoryAppKind = StoryApp["kind"];

export interface StoryIdleSlide {
  id: string;
  mediaUrl: string | null;
  mediaType: "image" | "video";
  headline: string;
  body: string;
}

export interface StoryBrand {
  logoUrl: string | null;
  /** Page background. */
  background: string;
  /** Cards, panels, the lightbox. */
  surface: string;
  text: string;
  /** Muted text. */
  muted: string;
  /** Buttons, active chips, markers. */
  accent: string;
  /** Text on top of the accent colour. */
  accentText: string;
  headingFont: string;
  bodyFont: string;
  /** Corner radius for cards and panels, in design px. */
  radius: number;
}

export interface StoryContent {
  version: 1;
  width: number;
  height: number;
  brand: StoryBrand;
  idle: {
    enabled: boolean;
    /** Return to the idle screen after this long with no touch. */
    timeoutSeconds: number;
    /** Each slide's time on screen. */
    slideSeconds: number;
    prompt: string;
    slides: StoryIdleSlide[];
  };
  home: {
    headline: string;
    subheadline: string;
    backgroundUrl: string | null;
  };
  apps: StoryApp[];
}

// ─── Defaults & factories ─────────────────────────────────────────────────────

export const STORY_APP_LABELS: Record<StoryAppKind, string> = {
  timeline: "Timeline",
  map: "Map",
  showcase: "Showcase",
  hotspots: "Hotspot image",
  video: "Video",
};

export const STORY_APP_DESCRIPTIONS: Record<StoryAppKind, string> = {
  timeline: "Milestones along a scrollable timeline, with era filters.",
  map: "Colour-coded pins on any map — world, region, campus or floor plan.",
  showcase: "A filterable grid of products, projects, people or case studies.",
  hotspots: "Tap points on a diagram, infographic or photo.",
  video: "Narrated chapters — videos, or photos with a voice-over, with captions.",
};

export function storyId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().slice(0, 12);
  } catch {
    /* insecure context — fall through */
  }
  return Math.random().toString(36).slice(2, 14);
}

const FONT_SANS = "var(--font-inter), Inter, system-ui, sans-serif";
const FONT_HEADING = "var(--font-archivo-expanded), 'Archivo Expanded', sans-serif";

export const DEFAULT_STORY_BRAND: StoryBrand = {
  logoUrl: null,
  background: "#0b0d12",
  surface: "#161a22",
  text: "#f5f6f8",
  muted: "#9aa3b2",
  accent: "#92ff5f",
  accentText: "#0b0d12",
  headingFont: FONT_HEADING,
  bodyFont: FONT_SANS,
  radius: 20,
};

export function emptyDetail(title = "Untitled"): StoryDetail {
  return { title, subtitle: "", body: "", media: [] };
}

export function makeFilter(label: string, color = "#92ff5f"): StoryFilter {
  return { id: storyId(), label, color };
}

export function makeApp(kind: StoryAppKind): StoryApp {
  const base = { id: storyId(), title: STORY_APP_LABELS[kind], tagline: "", coverUrl: null };
  switch (kind) {
    case "timeline":
      return { ...base, kind, filters: [], events: [] };
    case "map":
      return { ...base, kind, mapUrl: null, mode: "pins", dial: true, filters: [], pins: [], regions: [] };
    case "showcase":
      return { ...base, kind, filters: [], items: [] };
    case "hotspots":
      return { ...base, kind, imageUrl: null, hotspots: [] };
    case "video":
      return { ...base, kind, autoAdvance: true, chapters: [] };
  }
}

export function blankStory(width = 1920, height = 1080): StoryContent {
  return {
    version: 1,
    width,
    height,
    brand: { ...DEFAULT_STORY_BRAND },
    idle: {
      enabled: true,
      timeoutSeconds: 60,
      slideSeconds: 8,
      prompt: "Touch to explore",
      slides: [{ id: storyId(), mediaUrl: null, mediaType: "image", headline: "Welcome", body: "" }],
    },
    home: { headline: "Our Story", subheadline: "Tap a tile to explore", backgroundUrl: null },
    apps: [],
  };
}

export const DEFAULT_STORY_CONTENT: StoryContent = blankStory();

// ─── Reading ──────────────────────────────────────────────────────────────────

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const id = (v: unknown): string => (typeof v === "string" && v ? v : storyId());
const pct = (v: unknown): number => Math.min(100, Math.max(0, num(v, 50)));

function readMedia(v: unknown): StoryMedia | null {
  const r = obj(v);
  if (typeof r.url !== "string" || !r.url) return null;
  const type = r.type === "video" || r.type === "pdf" ? r.type : "image";
  return { id: id(r.id), type, url: r.url, assetId: strOrNull(r.assetId) ?? undefined, name: strOrNull(r.name) ?? undefined };
}

function readDetail(r: Record<string, unknown>): StoryDetail {
  return {
    title: str(r.title, "Untitled"),
    subtitle: str(r.subtitle),
    body: str(r.body),
    media: arr(r.media).map(readMedia).filter((m): m is StoryMedia => m !== null),
  };
}

function readFilters(v: unknown): StoryFilter[] {
  return arr(v).map((f) => {
    const r = obj(f);
    return { id: id(r.id), label: str(r.label, "Filter"), color: str(r.color, "#92ff5f") };
  });
}

function readApp(v: unknown): StoryApp | null {
  const r = obj(v);
  const base = { id: id(r.id), title: str(r.title, "Untitled"), tagline: str(r.tagline), coverUrl: strOrNull(r.coverUrl) };
  const filterId = (x: Record<string, unknown>) => strOrNull(x.filterId);
  switch (r.kind) {
    case "timeline":
      return {
        ...base,
        kind: "timeline",
        filters: readFilters(r.filters),
        events: arr(r.events).map((e) => {
          const x = obj(e);
          return { ...readDetail(x), id: id(x.id), year: num(x.year, 2000), dateLabel: str(x.dateLabel), filterId: filterId(x) };
        }),
      };
    case "map":
      return {
        ...base,
        kind: "map",
        mapUrl: strOrNull(r.mapUrl),
        mode: r.mode === "journey" || r.mode === "regions" ? r.mode : "pins",
        dial: r.dial !== false,
        filters: readFilters(r.filters),
        pins: arr(r.pins).map((p) => {
          const x = obj(p);
          return { ...readDetail(x), id: id(x.id), x: pct(x.x), y: pct(x.y), filterId: filterId(x) };
        }),
        regions: arr(r.regions).map((g) => {
          const x = obj(g);
          return {
            ...readDetail(x),
            id: id(x.id),
            points: arr(x.points).map((pt) => {
              const q = obj(pt);
              return { x: pct(q.x), y: pct(q.y) };
            }),
            filterId: filterId(x),
          };
        }),
      };
    case "showcase":
      return {
        ...base,
        kind: "showcase",
        filters: readFilters(r.filters),
        items: arr(r.items).map((i) => {
          const x = obj(i);
          return { ...readDetail(x), id: id(x.id), coverUrl: strOrNull(x.coverUrl), filterId: filterId(x) };
        }),
      };
    case "hotspots":
      return {
        ...base,
        kind: "hotspots",
        imageUrl: strOrNull(r.imageUrl),
        hotspots: arr(r.hotspots).map((h) => {
          const x = obj(h);
          return { ...readDetail(x), id: id(x.id), x: pct(x.x), y: pct(x.y) };
        }),
      };
    case "video":
      return {
        ...base,
        kind: "video",
        autoAdvance: r.autoAdvance !== false,
        chapters: arr(r.chapters).map((c) => {
          const x = obj(c);
          return {
            ...readDetail(x),
            id: id(x.id),
            videoUrl: strOrNull(x.videoUrl),
            posterUrl: strOrNull(x.posterUrl),
            voiceUrl: strOrNull(x.voiceUrl),
          };
        }),
      };
    default:
      return null;
  }
}

export function normalizeStoryContent(raw: unknown): StoryContent {
  const d = blankStory();
  if (!raw || typeof raw !== "object") return d;
  const r = obj(raw);
  const brand = { ...d.brand, ...obj(r.brand) } as StoryBrand;
  brand.logoUrl = strOrNull(brand.logoUrl);
  const idle = obj(r.idle);
  const home = obj(r.home);
  const side = (v: unknown, fb: number) => Math.min(7680, Math.max(200, Math.round(num(v, fb))));
  return {
    version: 1,
    width: side(r.width, 1920),
    height: side(r.height, 1080),
    brand,
    idle: {
      enabled: idle.enabled !== false,
      timeoutSeconds: Math.max(10, Math.round(num(idle.timeoutSeconds, 60))),
      slideSeconds: Math.max(2, Math.round(num(idle.slideSeconds, 8))),
      prompt: str(idle.prompt, "Touch to explore"),
      slides: arr(idle.slides).map((s) => {
        const x = obj(s);
        return {
          id: id(x.id),
          mediaUrl: strOrNull(x.mediaUrl),
          mediaType: x.mediaType === "video" ? "video" : "image",
          headline: str(x.headline),
          body: str(x.body),
        };
      }),
    },
    home: {
      headline: str(home.headline, d.home.headline),
      subheadline: str(home.subheadline),
      backgroundUrl: strOrNull(home.backgroundUrl),
    },
    apps: arr(r.apps).map(readApp).filter((a): a is StoryApp => a !== null),
  };
}

export function readStoryContent(templateContent: Record<string, unknown> | null | undefined): StoryContent | null {
  const slice = templateContent?.["story"];
  return slice ? normalizeStoryContent(slice) : null;
}
