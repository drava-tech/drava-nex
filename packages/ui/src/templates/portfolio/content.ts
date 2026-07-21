// Content shape for the Portfolio template. Stored on the experience as
// experience.templateContent.portfolio. Per-view so future views add their own slice.
// Shared by the CMS (editor + preview) and the screens app (live render).

/**
 * One drill-in section of a vertical: a button on the vertical page leading to
 * either an image slideshow or a videos grid (chosen per button in the editor).
 */
export interface PortfolioSection {
  name: string;
  /** What this button opens. Missing (older rows) → "images". */
  type?: "images" | "videos";
  images: string[];
  /** Video URLs for the "videos" grid. */
  videos?: string[];
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
    return {
      name: (s?.name ?? "").trim() || def.name,
      type: s?.type === "videos" ? ("videos" as const) : ("images" as const),
      images: cleanUrls(s?.images),
      videos: cleanUrls(s?.videos),
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
