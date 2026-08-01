// Content shape for the Portfolio template. Stored on the experience as
// experience.templateContent.portfolio. Per-view so future views add their own slice.
// Shared by the CMS (editor + preview) and the screens app (live render).

/**
 * One drill-in section of a vertical: a button on the vertical page leading to
 * either an image slideshow or a videos grid (chosen per button in the editor).
 */
/** What a section button opens once the split-view slider commits. */
export type PortfolioSectionType = "images" | "videos" | "gallery";

export interface PortfolioSection {
  name: string;
  /** What this button opens. Missing (older rows) → "images". */
  type?: PortfolioSectionType;
  images: string[];
  /** Video URLs for the "videos" grid. */
  videos?: string[];
  // ─── "gallery" type only ──────────────────────────────────────────────────
  // The text block beside the photos. The photos themselves are the first
  // GALLERY_PHOTO_COUNT entries of `images`, so a section already filled in as a
  // slideshow can be switched to "gallery" without re-picking anything.
  /** Large heading. Falls back to `name` when unset. */
  title?: string;
  /** Bold line under the title. */
  subtitle?: string;
  description?: string;
}

/** The gallery layout is designed around exactly four photos — one feature, three below. */
export const GALLERY_PHOTO_COUNT = 4;

/**
 * Styling for every "gallery" section, held once on the content rather than
 * per-section: new gallery sections are new copy and new photos, never a new
 * design. Mirrors how overview.* holds one set of values for all three cards.
 */
export interface PortfolioGalleryStyle {
  titleFontSize?: number;
  subtitleFontSize?: number;
  descriptionFontSize?: number;
  gap?: number;
  /** Outer margin around the layout — deliberately larger than `gap`. */
  padding?: number;
  backgroundColor?: string;
  textColor?: string;
  /** Share of the width an expanded photo takes, in percent. */
  expandedPct?: number;
  /** Blur applied to the un-expanded remainder. */
  blurPx?: number;
}

export const DEFAULT_GALLERY_TITLE_FONT_SIZE = 64;
export const DEFAULT_GALLERY_SUBTITLE_FONT_SIZE = 24;
export const DEFAULT_GALLERY_DESCRIPTION_FONT_SIZE = 20;
export const DEFAULT_GALLERY_GAP = 26;
export const DEFAULT_GALLERY_PADDING = 78;
export const DEFAULT_GALLERY_BACKGROUND_COLOR = "#e8e8f7";
export const DEFAULT_GALLERY_TEXT_COLOR = "#111114";
export const DEFAULT_GALLERY_EXPANDED_PCT = 70;
export const DEFAULT_GALLERY_BLUR_PX = 12;

/** Bounds shared by the editor's controls and the view's clamping. */
export const GALLERY_EXPANDED_PCT_MIN = 40;
export const GALLERY_EXPANDED_PCT_MAX = 90;
export const GALLERY_BLUR_PX_MIN = 0;
export const GALLERY_BLUR_PX_MAX = 40;

export const DEFAULT_PORTFOLIO_GALLERY_STYLE: Required<PortfolioGalleryStyle> = {
  titleFontSize: DEFAULT_GALLERY_TITLE_FONT_SIZE,
  subtitleFontSize: DEFAULT_GALLERY_SUBTITLE_FONT_SIZE,
  descriptionFontSize: DEFAULT_GALLERY_DESCRIPTION_FONT_SIZE,
  gap: DEFAULT_GALLERY_GAP,
  padding: DEFAULT_GALLERY_PADDING,
  backgroundColor: DEFAULT_GALLERY_BACKGROUND_COLOR,
  textColor: DEFAULT_GALLERY_TEXT_COLOR,
  expandedPct: DEFAULT_GALLERY_EXPANDED_PCT,
  blurPx: DEFAULT_GALLERY_BLUR_PX,
};

export function clampGalleryValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export interface OverviewCard {
  title: string;
  imageUrl: string;
  /** Video played in a popup when the first ("Watch Video") button is tapped. */
  videoUrl?: string;
  /** Shown below the image, above the buttons. Optional — older rows lack it. */
  description?: string;
  button1: string;
  button2: string;
  /** Exactly 2 after normalizeSections(); optional in storage (older rows lack it). */
  sections?: PortfolioSection[];
}

/** Which portfolio page is showing: overview (cardIndex null), a vertical, or a section slideshow. */
export interface PortfolioViewState {
  cardIndex: number | null;
  sectionIndex: number | null;
  /** When true, renders the split-panel comparison view instead of the vertical page. */
  splitView?: boolean;
  /** Set when the vertical page was reached by dragging past the threshold in
   * the split view — its back button returns to the split view instead of
   * the overview. */
  cameFromSplit?: boolean;
}

export interface PortfolioContent {
  /** One set of style values for every "gallery" section — see the type above. */
  gallery?: PortfolioGalleryStyle;
  overview: {
    cards: OverviewCard[];
    /** Style values (px) — one set shared by all 3 cards. */
    titleFontSize?: number;
    descriptionFontSize?: number;
    buttonFontSize?: number;
    // Card padding drives spacing throughout — outer padding AND the space
    // between title / image / description / buttons.
    cardPadding?: number;
  };
}

export const DEFAULT_TITLE_FONT_SIZE = 50;
export const DEFAULT_DESCRIPTION_FONT_SIZE = 22;
export const DEFAULT_BUTTON_FONT_SIZE = 20;
export const DEFAULT_CARD_PADDING = 44;

export const DEFAULT_SECTIONS: PortfolioSection[] = [
  { name: "Build", type: "images", images: [], videos: [] },
  { name: "Technology", type: "images", images: [], videos: [] },
];

const defaultSections = (): PortfolioSection[] =>
  DEFAULT_SECTIONS.map((s) => ({ name: s.name, type: s.type, images: [], videos: [] }));

export const DEFAULT_PORTFOLIO_CONTENT: PortfolioContent = {
  overview: {
    titleFontSize: DEFAULT_TITLE_FONT_SIZE,
    descriptionFontSize: DEFAULT_DESCRIPTION_FONT_SIZE,
    buttonFontSize: DEFAULT_BUTTON_FONT_SIZE,
    cardPadding: DEFAULT_CARD_PADDING,
    cards: [
      {
        title: "Experience Center",
        imageUrl: "/media/experience-center.png",
        videoUrl: "",
        description: "A hands-on showcase of our flagship spaces, walking through the ideas and craft behind every build.",
        button1: "Watch Video",
        button2: "Projects",
        sections: defaultSections(),
      },
      {
        title: "Architecture & Interiors",
        imageUrl: "/media/interior-space.png",
        videoUrl: "",
        description: "Selected projects spanning residential, commercial, and hospitality interiors, from concept to completion.",
        button1: "Watch Video",
        button2: "Projects",
        sections: defaultSections(),
      },
      {
        title: "Brand Solutions",
        imageUrl: "/media/brand-experiences.png",
        videoUrl: "",
        description: "Brand identities and campaigns crafted to help our clients stand out across every touchpoint.",
        button1: "Watch Video",
        button2: "Projects",
        sections: defaultSections(),
      },
    ],
  },
};

/**
 * Always returns exactly 2 well-formed sections. Older stored rows lack
 * `sections` entirely — blank/missing names fall back to the defaults and
 * missing image lists become empty.
 */
export function normalizeSections(sections?: PortfolioSection[]): PortfolioSection[] {
  const cleanUrls = (raw: unknown): string[] =>
    (Array.isArray(raw) ? raw : []).filter(
      (u): u is string => typeof u === "string" && u.length > 0
    );
  return DEFAULT_SECTIONS.map((def, i) => {
    const s = sections?.[i];
    const name = (s?.name ?? "").trim() || def.name;
    const type: PortfolioSectionType =
      s?.type === "videos" ? "videos" : s?.type === "gallery" ? "gallery" : "images";
    return {
      name,
      type,
      images: cleanUrls(s?.images),
      videos: cleanUrls(s?.videos),
      // Carried through for every type, not just "gallery", so switching a
      // section back and forth doesn't quietly discard its copy.
      ...(typeof s?.title === "string" ? { title: s.title } : {}),
      ...(typeof s?.subtitle === "string" ? { subtitle: s.subtitle } : {}),
      ...(typeof s?.description === "string" ? { description: s.description } : {}),
    };
  });
}

/** Reads the portfolio content slice off an experience row, or null if unset. */
export function readPortfolioContent(
  templateContent: Record<string, unknown> | null | undefined
): PortfolioContent | null {
  const slice = templateContent?.["portfolio"];
  if (!slice) return null;
  const content = slice as PortfolioContent;
  const cards = content.overview?.cards;
  if (!Array.isArray(cards)) return content;
  return {
    ...content,
    overview: {
      ...content.overview,
      cards: cards.map((c) => ({ ...c, sections: normalizeSections(c.sections) })),
    },
  };
}

/** URL-safe segment from a display name: "Architecture & Interiors" → "architecture-interiors". */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Deterministic unique slugs for a list of names (fallback + `-${i+1}` suffix on collision). */
function uniqueSlugs(names: string[], fallbackPrefix: string): string[] {
  const seen = new Set<string>();
  return names.map((name, i) => {
    let slug = slugify(name) || `${fallbackPrefix}-${i + 1}`;
    if (seen.has(slug)) slug = `${slug}-${i + 1}`;
    seen.add(slug);
    return slug;
  });
}

/** Route segments for the vertical cards — shared by the CMS layout and nav so URLs stay consistent. */
export function cardSlugs(cards: OverviewCard[]): string[] {
  return uniqueSlugs(cards.map((c) => c.title), "vertical");
}

/**
 * Reserved second URL segment (`/<vertical-slug>/split-view`) that marks the
 * split-panel view instead of a section slideshow — shared by the routed nav
 * (which writes it) and the URL→view resolver (which reads it), so the
 * standalone preview tab's real URL navigation can represent `splitView`,
 * which a plain section-slug lookup has no way to encode.
 */
export const SPLIT_VIEW_SEGMENT = "split-view";

/** Route segments for a card's sections. */
export function sectionSlugs(sections: PortfolioSection[]): string[] {
  return uniqueSlugs(sections.map((s) => s.name), "section");
}
